#!/usr/bin/env python3
"""Fetch a reviewed GitHub commit and update ONLY the isolated acceptance app."""
import argparse,fcntl,io,json,os,re,shutil,socket,subprocess,tarfile,time,urllib.request
from pathlib import Path
REPO='https://github.com/yongliancai/webAVR.git'
BRANCH='next-preview'
PORT=4398
NAME='webavr-next-acceptance'

def run(args,env=None):
    return subprocess.run([str(a) for a in args],check=True,capture_output=True,text=True,env=env).stdout

def safe_members(tar,destination):
    members=tar.getmembers()
    for member in members:
        path=Path(member.name)
        if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0]!='next':
            raise ValueError('Unsafe release archive path')
        if not (member.isfile() or member.isdir()):
            raise ValueError('Release archive links and special files are forbidden')
        target=(destination/path).resolve()
        if destination.resolve() not in target.parents:
            raise ValueError('Release archive escapes destination')
    return members

def healthy():
    try:
        with urllib.request.urlopen('http://localhost:'+str(PORT)+'/api/health',timeout=2) as response:
            return response.status==200
    except OSError:
        return False

def wait_ready():
    for _ in range(80):
        if healthy():return
        time.sleep(.5)
    raise RuntimeError('Acceptance health check did not pass')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit',required=True,help='Full reviewed 40-character GitHub commit SHA')
    parser.add_argument('--node',default='/home/webavr/.nvm/versions/node/v22.12.0/bin/node')
    args=parser.parse_args()
    if not re.fullmatch('[0-9a-f]{40}',args.commit):parser.error('Require a full commit SHA')
    os.umask(0o077)
    root=Path.home()/'webavr-next'
    if root.is_symlink():raise RuntimeError('Refuse symlink deployment root')
    root.mkdir(mode=0o700,exist_ok=True)
    with (root/'update.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        return deploy(root,args)

def deploy(root,args):
    marker=root/'layout.json'
    if marker.exists():
        if json.loads(marker.read_text()).get('syntheticOnly') is not True:raise RuntimeError('Invalid layout marker')
    else:
        if any(p.name not in ['update.lock'] for p in root.iterdir()):raise RuntimeError('Refuse unmarked nonempty deployment directory')
        marker.write_text(json.dumps({'syntheticOnly':True,'repository':REPO,'port':PORT}))
    shared=root/'shared';shared.mkdir(mode=0o700,exist_ok=True)
    node=Path(args.node).resolve()
    env={**os.environ,'PATH':str(node.parent)+':/usr/local/bin:/usr/bin:/bin','PM2_HOME':str(shared/'pm2')}
    if int(run([node,'--version'],env=env).strip().lstrip('v').split('.')[0])<22:raise RuntimeError('Node22 or later required')
    repository=root/'repository'
    if not repository.exists():run(['git','clone','--no-checkout',REPO,repository],env=env)
    if run(['git','-C',repository,'remote','get-url','origin'],env=env).strip()!=REPO:raise RuntimeError('Unexpected repository remote')
    run(['git','-C',repository,'fetch','origin','refs/heads/'+BRANCH],env=env)
    run(['git','-C',repository,'merge-base','--is-ancestor',args.commit,'FETCH_HEAD'],env=env)
    releases=root/'releases';releases.mkdir(mode=0o700,exist_ok=True)
    release=releases/args.commit
    if not release.exists():
        release.mkdir(mode=0o700)
        try:
            archive=subprocess.run(['git','-C',str(repository),'archive','--format=tar',args.commit,'next'],check=True,capture_output=True).stdout
            with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
                tar.extractall(release,members=safe_members(tar,release))
            app=release/'next'
            # Build before stopping the working acceptance service.
            run(['npm','--prefix',app,'ci','--ignore-scripts','--no-audit','--no-fund'],env=env)
            run(['npm','--prefix',app,'run','build'],env=env)
            (release/'ready.json').write_text(json.dumps({'commit':args.commit}))
        except Exception:
            shutil.rmtree(release)
            raise
    if not (release/'ready.json').is_file():raise RuntimeError('Incomplete release directory')
    app=release/'next';current=root/'current';previous=current.resolve() if current.is_symlink() else None
    if previous is not None and releases.resolve() not in previous.parents:raise RuntimeError('Invalid previous release')
    old_config=shared/'ecosystem.json';old_config_text=old_config.read_text() if old_config.exists() else None
    data=shared/'acceptance'
    backups=root/'backups';backups.mkdir(mode=0o700,exist_ok=True)
    stamp=time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+str(time.time_ns())
    # Query only this deployment's PM2 namespace; never touch legacy PM2.
    apps=json.loads(run(['pm2','jlist'],env=env))
    exists=any(a.get('name')==NAME for a in apps)
    if not exists:
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1',PORT))==0:raise RuntimeError('Acceptance port belongs to another service')
    if exists:run(['pm2','stop',NAME],env=env)
    # No second PGlite connection while backing up its files.
    backup=None
    try:
        if data.exists():
            identity=data/'acceptance-identity.json'
            if not identity.is_file() or json.loads(identity.read_text()).get('syntheticOnly') is not True:raise RuntimeError('Refuse unmarked acceptance data')
            backup=backups/('data-'+stamp);shutil.copytree(data,backup)
        config={'apps':[{'name':NAME,'script':str(app/'studio/serve-acceptance-test.mjs'),'cwd':str(app),'interpreter':str(node),'exec_mode':'fork','instances':1,'kill_timeout':10000,'min_uptime':10000,'max_restarts':3,'restart_delay':2000,'out_file':str(shared/'out.log'),'error_file':str(shared/'error.log'),'env':{'WEBAVR_ACCEPTANCE_ROOT':str(data),'WEBAVR_ACCEPTANCE_PORT':str(PORT)}}]}
        old_config.write_text(json.dumps(config,indent=2))
        run(['pm2','startOrRestart',old_config,'--update-env'],env=env)
        wait_ready()
        # Verify we started this service rather than accepting an unrelated 200.
        with urllib.request.urlopen('http://localhost:'+str(PORT)+'/test/evidence',timeout=5) as response:
            if json.load(response).get('syntheticOnly') is not True:raise RuntimeError('Acceptance identity mismatch')
        link=root/'current.pending'
        if link.is_symlink():link.unlink()
        link.symlink_to(release);link.replace(current)
        run(['pm2','save'],env=env)
        status={'commit':args.commit,'previousCommit':previous.name if previous else None,'port':PORT,'syntheticOnly':True,'backup':str(backup) if backup else None}
        (shared/'version.json').write_text(json.dumps(status,indent=2))
        print(json.dumps(status))
    except Exception:
        subprocess.run(['pm2','stop',NAME],env=env,capture_output=True)
        if backup:
            if data.exists():data.rename(shared/('failed-data-'+stamp))
            shutil.copytree(backup,data)
        if old_config_text and previous:
            old_config.write_text(old_config_text)
            run(['pm2','startOrRestart',old_config,'--update-env'],env=env)
            wait_ready()
            if current.is_symlink():current.unlink()
            current.symlink_to(previous)
            run(['pm2','save'],env=env)
        raise

if __name__=='__main__':main()
