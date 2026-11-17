import contextlib
import io
import secrets
import unittest
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

from tools.provision_staff import provision


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.roster = [dict(email=f'{n}@example.invalid', role='sales', full_name=f'Test {n}',
                            branch_name='R' if n == 0 else 'K' if n == 1 else None) for n in range(15)]
        self.branches = [dict(id=str(uuid4()), name=name) for name in ['R', 'K']]
        self.users, self.assigned, self.patched = {}, {}, {}
        self.reject_create = False
        self.password = secrets.token_urlsafe(16)

    def request(self, method, path, data=None):
        table = urlsplit(path).path.split('/')[-1]
        args = parse_qs(urlsplit(path).query)
        if method == 'GET':
            if table == 'hm_preset_roles':
                return self.roster
            if table == 'branches':
                return self.branches
            if table == 'profiles':
                if 'email' in args:
                    uid = self.users.get(args['email'][0][3:])
                else:
                    uid = args['id'][0][3:]
                    self.assertIn(uid, self.users.values())
                return [{'id': uid}] if uid else []
        if method == 'POST' and table == 'users':
            if self.reject_create:
                raise RuntimeError('duplicate identity')
            self.assertTrue(data['email_confirm'])
            self.assertEqual(data['password'], self.password)
            self.assertNotIn(data['email'], self.users)
            uid = self.users[data['email']] = str(uuid4())
            return {'id': uid, 'email': data['email']}
        if method == 'PATCH' and table == 'profiles':
            self.patched[args['id'][0][3:]] = data['branch_id']
        elif method == 'POST' and table == 'user_roles':
            self.assigned[data['user_id']] = data['role']
        else:
            self.fail((method, path))

    def test_new_uids_only_and_rerun_leaves_existing_accounts_alone(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            provision(self.request, lambda email: self.password)
            self.assertEqual(self.assigned, {self.users[r['email']]: r['role'] for r in self.roster})
            self.assertEqual(self.patched, {self.users[self.roster[n]['email']]: b['id'] for n, b in enumerate(self.branches)})
            # Simulate a deliberate role revocation before a second run.
            self.assigned.clear()
            self.patched.clear()
            provision(self.request, lambda email: self.fail('asked for existing password'))
            self.assertFalse(self.assigned or self.patched)
        self.assertNotIn(self.password, output.getvalue())

    def test_conflicting_auth_identity_is_not_granted_a_role(self):
        self.reject_create = True
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, 'duplicate identity'):
            provision(self.request, lambda email: self.password)
        self.assertFalse(self.assigned or self.patched)
