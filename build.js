const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const JavaScriptObfuscator = require('javascript-obfuscator');

const SRC_DIR = __dirname;
const BUILD_DIR = path.join(__dirname, '.build');

const JS_FILES = ['main.js', 'preload.js', 'renderer.js', 'store.js'];
const COPY_FILES = ['index.html', 'styles.css', 'package.json', 'package-lock.json', 'version.json', 'LICENSE'];
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
  for (const file of JS_FILES) {
    const src = path.join(SRC_DIR, file);
    const dst = path.join(BUILD_DIR, file);
    const code = fs.readFileSync(src, 'utf8');
    const result = JavaScriptObfuscator.obfuscate(code, OBFUSCATOR_OPTIONS);
    fs.writeFileSync(dst, result.getObfuscatedCode(), 'utf8');
    const ratio = ((1 - result.getObfuscatedCode().length / code.length) * -100).toFixed(0);
    console.log(`✓ Obfuscated ${file} (+${ratio}% size)`);
  }
}

function copyFiles() {
  for (const file of COPY_FILES) {
    const src = path.join(SRC_DIR, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(BUILD_DIR, file));
      console.log(`✓ Copied ${file}`);
    }
  }
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
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
  const files = ['renderer.js', 'preload.js', 'index.html', 'styles.css'];
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
    '--app-version=1.0.2',
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
  console.log('✓ Installer: dist/installer/PaltoCraft-Setup-1.0.2.exe');
}

console.log('🔨 PaltoCraft Build\n');
clean();
obfuscateJS();
copyFiles();
copyDirs();
generateIntegrity();
package_();
buildInstaller();
console.log('\n✅ Build complete!');
