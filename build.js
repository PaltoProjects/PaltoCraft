const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC_DIR = __dirname;
const BUILD_DIR = path.join(__dirname, '.build');

// Single source of truth for the version — read from package.json so it never
// drifts out of sync with the rest of the project.
const VERSION = require('./package.json').version;
// electron-packager's CLI coerces a 2-segment value like "1.2" into the number
// 1.2 and then rejects it ("Invalid processed options"), so pad to 3 segments
// for the exe metadata. User-facing version stays VERSION ("1.2").
const WIN_VERSION = VERSION.split('.').concat(['0', '0', '0']).slice(0, 3).join('.');

const JS_FILES = ['main.js', 'preload.js', 'renderer.js', 'store.js'];
const COPY_FILES = ['index.html', 'styles.css', 'package.json', 'package-lock.json', 'version.json', 'servers.json', 'LICENSE'];
const COPY_DIRS = ['assets', 'node_modules'];

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayThreshold: 0.75,
  unicodeEscapeSequence: false,
  splitStrings: true,
  splitStringsChunkLength: 10
};

function clean() {
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  console.log('✓ Cleaned .build/');
}

function obfuscateJS() {
  // Inject admin hash from gitignored .admin-secret (contains UUID line)
  const secretPath = path.join(SRC_DIR, '.admin-secret');
  let adminHash = '';
  if (fs.existsSync(secretPath)) {
    const raw = fs.readFileSync(secretPath, 'utf8').trim().replace(/-/g, '');
    adminHash = crypto.createHash('sha256').update(raw).digest('hex');
    console.log('✓ Admin hash injected from .admin-secret');
  } else {
    console.warn('⚠ .admin-secret not found — admin panel will be disabled in build');
  }

  for (const file of JS_FILES) {
    const src = path.join(SRC_DIR, file);
    const dst = path.join(BUILD_DIR, file);
    let code = fs.readFileSync(src, 'utf8');
    // Replace placeholder with real hash before obfuscation
    if (adminHash) {
      code = code.replace(/__ADMIN_HASH__/g, adminHash);
    }
    const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(dst, result.getObfuscatedCode(), 'utf8');
    const ratio = ((1 - result.getObfuscatedCode().length / code.length) * -100).toFixed(0);
    console.log(`✓ Obfuscated ${file} (+${ratio}% size)`);
  }
}

function minifyHTML(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><')
    .replace(/\s+>/g, '>')
    .replace(/<\s+/g, '<')
    .trim();
}

function minifyCSS(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '')
    .replace(/\s*{\s*/g, '{')
    .replace(/\s*}\s*/g, '}')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s*;\s*/g, ';')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function copyFiles() {
  for (const file of COPY_FILES) {
    const src = path.join(SRC_DIR, file);
    if (!fs.existsSync(src)) continue;
    let content = fs.readFileSync(src, 'utf8');
    if (file.endsWith('.html')) {
      content = minifyHTML(content);
      console.log(`✓ Minified + copied ${file}`);
    } else if (file.endsWith('.css')) {
      content = minifyCSS(content);
      console.log(`✓ Minified + copied ${file}`);
    } else {
      console.log(`✓ Copied ${file}`);
    }
    fs.writeFileSync(path.join(BUILD_DIR, file), content, 'utf8');
  }
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true, dereference: true, force: true });
}

function copyDirs() {
  for (const dir of COPY_DIRS) {
    const src = path.join(SRC_DIR, dir);
    const dst = path.join(BUILD_DIR, dir);
    copyDir(src, dst);
    console.log(`✓ Copied ${dir}/`);
  }
}

function generateIntegrity() {
  const files = ['main.js', 'preload.js', 'renderer.js', 'store.js', 'index.html', 'styles.css'];
  const manifest = {};
  for (const file of files) {
    const filePath = path.join(BUILD_DIR, file);
    if (fs.existsSync(filePath)) {
      manifest[file] = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
      console.log(`✓ Hashed ${file}`);
    }
  }
  fs.writeFileSync(path.join(BUILD_DIR, 'integrity.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('✓ integrity.json generated');
}

function package_() {
  console.log('\n📦 Packaging with electron-packager...');
  const cmd = [
    'npx electron-packager',
    '".build"',
    'PaltoCraft',
    '--platform=win32',
    '--arch=x64',
    '--out=dist',
    '--overwrite',
    `--app-version=${WIN_VERSION}`,
    '--icon=assets/icon.ico',
    '--no-asar',
    '--prune'
  ].join(' ');

  execSync(cmd, { stdio: 'inherit', cwd: SRC_DIR });
  console.log('✓ Packaged to dist/PaltoCraft-win32-x64/');
}

function buildInstaller() {
  console.log('\n📦 Compiling NSIS installer...');
  execSync(
    'powershell -Command "& \'C:\\Program Files (x86)\\NSIS\\makensis.exe\' /INPUTCHARSET UTF8 \'installer.nsi\'"',
    { stdio: 'inherit', cwd: SRC_DIR }
  );
  console.log(`✓ Installer: dist/PaltoCraft-Setup-${VERSION}.exe`);
}

function packInstaller() {
  const upx = 'C:\\upx\\upx.exe';
  const exe = path.join(SRC_DIR, 'dist', `PaltoCraft-Setup-${VERSION}.exe`);
  if (!fs.existsSync(upx)) { console.log('⚠ UPX не найден — пропускаем упаковку'); return; }
  if (!fs.existsSync(exe)) { console.log('⚠ Installer не найден — пропускаем UPX'); return; }
  console.log('\n📦 Packing installer with UPX...');
  execSync(`"${upx}" --best --lzma "${exe}"`, { stdio: 'inherit' });
  console.log('✓ UPX done');
}

console.log('🔨 PaltoCraft Build\n');
clean();
obfuscateJS();
copyFiles();
copyDirs();
generateIntegrity();
package_();
buildInstaller();
packInstaller();
console.log('\n✅ Build complete!');
