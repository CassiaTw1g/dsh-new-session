#!/usr/bin/env node
/**
 * 把 dsh-new-session 装进一个 DSH profile。
 *
 * 只动三处，全部留备份：
 *   1. node_modules/dsh-new-session/   复制本包
 *   2. package.json  dependencies      加一条 file: 依赖
 *   3. package.json  dsh.profile.bundles  加一行 bundle
 *
 * 之所以不直接调 `dsh plugin add`：桌面版运行期间 profile 被 pnpm 锁住，
 * 而这里只做文件级安装，不需要 pnpm，也不需要停掉正在跑的宿主（改完重启即可）。
 *
 * 用法：
 *   node tools/install-profile.mjs                    # 默认 desktop
 *   node tools/install-profile.mjs --profile headless
 *   node tools/install-profile.mjs --dry-run
 *   node tools/install-profile.mjs --profile headless --rollback
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, '..');
const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
const packageName = manifest.name;

/** 解析命令行。 */
function parseArgs(argv) {
  const options = { profile: 'desktop', dryRun: false, rollback: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--dry-run') options.dryRun = true;
    else if (argument === '--rollback') options.rollback = true;
    else if (argument === '--profile') {
      options.profile = argv[index + 1];
      index += 1;
    } else if (argument.startsWith('--profile=')) options.profile = argument.slice('--profile='.length);
    else throw new Error(`unknown argument ${JSON.stringify(argument)}`);
  }
  if (typeof options.profile !== 'string' || options.profile.trim() === '') throw new Error('--profile needs a name');
  return options;
}

function dshHome() {
  return process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== ''
    ? resolve(process.env.DSH_HOME)
    : join(homedir(), '.dsh');
}

function stamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 复制本包（排除 node_modules/.git 之类）。 */
function copyPackage(target) {
  rmSync(target, { recursive: true, force: true });
  cpSync(packageDir, target, {
    recursive: true,
    filter: (source) => {
      const name = source.split(/[\\/]/u).pop();
      return name !== 'node_modules' && name !== '.git' && name !== '.DS_Store';
    },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function findLatestBackup(profileDir) {
  let entries;
  try {
    entries = readdirSync(profileDir);
  } catch {
    return undefined;
  }
  const backups = entries
    .filter((name) => name.startsWith('package.json.bak-newsession-'))
    .sort();
  return backups.length === 0 ? undefined : join(profileDir, backups[backups.length - 1]);
}

function help() {
  process.stdout.write(`dsh-new-session installer

  node tools/install-profile.mjs [--profile <name>] [--dry-run]
  node tools/install-profile.mjs [--profile <name>] --rollback

  --profile   要安装的 profile（默认 desktop；也可以用 headless / web / tui）
  --dry-run   只打印会做什么，不落盘
  --rollback  恢复最近一次安装前的 package.json，并删掉已复制的包
`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    help();
    return 0;
  }
  const profileDir = join(dshHome(), 'profiles', options.profile);
  const manifestPath = join(profileDir, 'package.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`profile "${options.profile}" is not initialized: ${manifestPath} does not exist`);
  }
  const targetDir = join(profileDir, 'node_modules', packageName);

  if (options.rollback) {
    const backup = findLatestBackup(profileDir);
    if (backup === undefined) throw new Error(`no package.json.bak-newsession-* backup in ${profileDir}`);
    if (options.dryRun) {
      process.stdout.write(`would restore ${backup} → ${manifestPath}\nwould remove ${targetDir}\n`);
      return 0;
    }
    cpSync(backup, manifestPath);
    rmSync(targetDir, { recursive: true, force: true });
    process.stdout.write(`restored ${backup}\nremoved ${targetDir}\n`);
    return 0;
  }

  const profile = readJson(manifestPath);
  const before = JSON.stringify(profile);
  profile.dependencies = { ...(profile.dependencies ?? {}) };
  profile.dependencies[packageName] = `file:${packageDir}`;
  profile.dsh = { ...(profile.dsh ?? {}) };
  profile.dsh.profile = { ...(profile.dsh?.profile ?? {}) };
  const bundles = Array.isArray(profile.dsh.profile.bundles) ? [...profile.dsh.profile.bundles] : [];
  if (!bundles.includes(packageName)) bundles.push(packageName);
  profile.dsh.profile.bundles = bundles;

  if (options.dryRun) {
    process.stdout.write([
      `profile:   ${profileDir}`,
      `copy:      ${packageDir} → ${targetDir}`,
      `depend on: ${packageName} = file:${packageDir}`,
      `bundles:   ${bundles.join(', ')}`,
      '',
    ].join('\n'));
    return 0;
  }

  const backupPath = join(profileDir, `package.json.bak-newsession-${stamp()}`);
  writeFileSync(backupPath, `${JSON.stringify(JSON.parse(before), null, 2)}\n`, 'utf8');

  copyPackage(targetDir);
  writeFileSync(manifestPath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');

  process.stdout.write([
    `installed ${packageName} into profile "${options.profile}"`,
    `  package:  ${targetDir}`,
    `  backup:   ${backupPath}`,
    '',
    '接下来：完全退出 DSH（桌面版托盘也要退），再重新打开；',
    'Web UI 里刷新一次页面，新工具与卡片就都在了。',
    '想撤掉：node tools/install-profile.mjs --profile ' + options.profile + ' --rollback',
    '',
  ].join('\n'));
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`install-profile: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
