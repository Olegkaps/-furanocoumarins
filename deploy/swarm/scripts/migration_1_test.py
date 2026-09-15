"""Exercise operator-visible migration behavior without a Docker daemon."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

RUNNER = Path(__file__).with_name('migration_1.sh')
FAKE_DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
p = pathlib.Path(os.environ['CASE_DIR'])
args = sys.argv[1:]
with (p/'calls').open('a') as f: f.write(json.dumps(args)+'\n')
scenario = os.environ['SCENARIO']
state = json.loads((p/'state').read_text()) if (p/'state').exists() else {}
def save(): (p/'state').write_text(json.dumps(state))
if args[0] == 'info':
 print('manager1' if 'NodeID' in args[-1] else ('false' if scenario=='not_manager' else 'true'))
elif args[:2] == ['node','inspect']: print('active')
elif args[:2] == ['secret','inspect']:
 sys.exit(1 if scenario=='missing_secret' else 0)
elif args[:2] == ['network','inspect']: print('overlay')
elif args[0] == 'build':
 if scenario=='build_failure': sys.exit(1)
 pathlib.Path(args[args.index('--iidfile')+1]).write_text('sha256:'+'1'*64)
elif args[:2] == ['service','inspect']:
 if '--format' not in args: sys.exit(0 if scenario=='collision' else 1)
 if 'Networks' in args[3]:
  print('' if scenario=='missing_network' else 'private-network\nprivate-network')
 else: print('2')
elif args[:2] == ['service','create']:
 if scenario=='race_collision': sys.exit(1)
 state['reserved']=True; save()
elif args[:2] == ['service','scale']:
 service, replicas = args[-1].split('=')
 state[service]=replicas; save()
elif args[:2] == ['service','ps']:
 service=args[-1]
 if service.endswith('go-auth'):
  if scenario=='writer_timeout': print('Running 5 seconds ago')
  elif scenario=='writer_inspect_failure': sys.exit(1)
  else:
   state['writer_checks']=state.get('writer_checks',0)+1; save()
   print('Running 5 seconds ago' if state['writer_checks']==1 else 'Shutdown 1 second ago')
 elif state.get(service)=='0': print('Shutdown 1 second ago')
 elif scenario=='failed': print('Failed 1 second ago')
 elif scenario=='rejected': print('Rejected 1 second ago')
 elif scenario=='timeout': print('Running 1 second ago')
 elif scenario=='interrupt': os.kill(os.getppid(), 15)
 else: print('Complete 1 second ago')
elif args[:2] == ['service','logs']: print('Migration log')
else: raise Exception('Unexpected Docker call: '+str(args))
'''


class MigrationCommandTest(unittest.TestCase):
    def run_case(self, scenario):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            docker = root / 'docker'
            docker.write_text(FAKE_DOCKER)
            docker.chmod(0o755)
            env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}',
                       CASE_DIR=directory, SCENARIO=scenario,
                       WAIT_ATTEMPTS='2', WAIT_INTERVAL='0')
            result = subprocess.run(['bash', str(RUNNER)], env=env,
                                    capture_output=True, text=True, timeout=15)
            calls = [json.loads(line) for line in (root/'calls').read_text().splitlines()]
            for call in calls:
                if call[0] == 'build':
                    self.assertFalse(Path(call[call.index('--iidfile') + 1]).exists())
            state = json.loads((root/'state').read_text()) if (root/'state').exists() else {}
            return result, calls, state

    def test_success_builds_before_stop_and_keeps_writer_stopped(self):
        result, calls, state = self.run_case('success')
        self.assertEqual(result.returncode, 0, result.stderr)
        build = next(i for i, c in enumerate(calls) if c[0] == 'build')
        reserve = next(i for i, c in enumerate(calls) if c[:2] == ['service', 'create'])
        stop = next(i for i, c in enumerate(calls) if c[-1] == 'furanocoumarins_go-auth=0')
        start = next(i for i, c in enumerate(calls) if c[-1] == 'furanocoumarins_migration-1=1')
        self.assertLess(build, reserve)
        self.assertLess(reserve, stop)
        self.assertLess(stop, start)
        self.assertEqual(state['furanocoumarins_go-auth'], '0')
        self.assertEqual(state['writer_checks'], 2)
        create = calls[reserve]
        self.assertEqual(create[-1], 'sha256:' + '1' * 64)
        self.assertNotIn('-t', calls[build])
        self.assertFalse(any(c[:2] == ['image', 'inspect'] for c in calls))
        self.assertIn('PG_PASSWORD_FILE=/run/secrets/postgres_password', create)
        self.assertIn('node.id==manager1', create)
        self.assertNotIn('--filter', ' '.join(sum(calls, [])))
        self.assertFalse(any(c[:2] in (['stack', 'deploy'], ['service', 'rm']) for c in calls))

    def test_preflight_and_reservation_failures_do_not_touch_writers(self):
        for scenario in ('not_manager', 'missing_secret', 'missing_network', 'build_failure', 'collision', 'race_collision'):
            with self.subTest(scenario=scenario):
                result, calls, state = self.run_case(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(any(c[:2] == ['service', 'scale'] for c in calls))
                self.assertNotIn('furanocoumarins_go-auth', state)

    def test_failure_timeout_and_interrupt_cancel_job_without_resuming_writers(self):
        for scenario in ('failed', 'rejected', 'timeout', 'interrupt', 'writer_timeout', 'writer_inspect_failure'):
            with self.subTest(scenario=scenario):
                result, calls, state = self.run_case(scenario)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(state['furanocoumarins_go-auth'], '0')
                self.assertEqual(state['furanocoumarins_migration-1'], '0')
                self.assertFalse(any(c[:2] == ['service', 'rm'] for c in calls))
                if scenario.startswith('writer_'):
                    self.assertFalse(any(c[-1] == 'furanocoumarins_migration-1=1' for c in calls))


if __name__ == '__main__':
    unittest.main()
