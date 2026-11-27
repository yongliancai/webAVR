#!/usr/bin/env python3
"""Deploy one reviewed GitHub commit; never replaces the production database."""
import argparse,fcntl,json,os,pathlib,re,subprocess,tarfile,time,urllib.request
p=argparse.ArgumentParser();p.add_argument('commit');p.add_argument('--root',default='/home/webavr-deploy/webavr-next/shared/production');args=p.parse_args()
if not re.fullmatch('[0-9a-f]{40}',args.commit):raise SystemExit('A complete reviewed commit SHA is required')
root=pathlib.Path(args.root).resolve();lock=(root/'deployment.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
config=json.loads((root/'service.json').read_text())
if config.get('environment')!='production' or not config['database']['database'].endswith('_production') or config.get('port')!=4500:raise SystemExit('Not an isolated production configuration')
node='/home/webavr/.nvm/versions/node/v22.12.0/bin';env=dict(os.environ,PATH=node+':/usr/local/bin:/usr/bin:/bin',PM2_HOME=str(root/'pm2'))
def run(*cmd,**kw):return subprocess.run(cmd,env=env,check=True,**kw)
def healthy():
 try:
  with urllib.request.urlopen('http://127.0.0.1:4500/api/health',timeout=5) as r:return r.status==200 and json.load(r).get('status')=='ok'
 except Exception:return False
old=json.loads((root/'version.json').read_text())
if old['commit']==args.commit:
 if not healthy():raise SystemExit('Existing production version is not healthy')
 print(json.dumps({'unchanged':True,'commit':args.commit}));raise SystemExit(0)
repo=root.parents[1]/'repository';run('git','-C',str(repo),'fetch','origin','next-preview');run('git','-C',str(repo),'merge-base','--is-ancestor',args.commit,'origin/next-preview')
release=root/'releases'/args.commit
if release.exists():raise SystemExit('Release path already exists; review it before retrying')
release.mkdir(parents=True,mode=0o700);archive=release/'source.tar'
run('git','-C',str(repo),'archive','--format=tar','--output='+str(archive),args.commit,'next')
with tarfile.open(archive) as t:
 for m in t.getmembers():
  if (m.name!='next' and not m.name.startswith('next/')) or '..' in pathlib.PurePosixPath(m.name).parts or m.issym() or m.islnk():raise SystemExit('Unexpected archive entry')
 t.extractall(release,filter='data')
work=release/'next'
with (root/'deployment-build.log').open('a') as log:
 run('npm','ci','--no-audit','--no-fund',cwd=work,stdout=log,stderr=subprocess.STDOUT);run('npm','run','build',cwd=work,stdout=log,stderr=subprocess.STDOUT)
run(str(root/'backup-production.sh'))
ecoPath=root/'ecosystem.json';original=ecoPath.read_text();eco=json.loads(original);eco['apps'][0]['cwd']=str(work);ecoPath.write_text(json.dumps(eco))
def switch_runtime():
 # PM2 reload can retain the old absolute script path across release directories.
 subprocess.run(['pm2','delete','webavr-production'],env=env,check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 run('pm2','start',str(ecoPath))
try:
 switch_runtime()
 for _ in range(40):
  if healthy():break
  time.sleep(.5)
 else:raise RuntimeError('New runtime health failed')
 proc=json.loads(run('pm2','jlist',capture_output=True,text=True).stdout)
 actual=next(x for x in proc if x['name']=='webavr-production')['pm2_env']
 if pathlib.Path(actual['pm_cwd'])!=work or not actual['pm_exec_path'].endswith('/serve-production.mjs'):raise RuntimeError('Unexpected runtime path')
 run('pm2','save');version=json.loads((work/'package.json').read_text())['version'];(root/'version.json').write_text(json.dumps({**old,'version':version,'commit':args.commit}));print(json.dumps({'updated':True,'version':version,'commit':args.commit,'databaseRestored':False}))
except Exception:
 ecoPath.write_text(original);switch_runtime();run('pm2','save');raise
