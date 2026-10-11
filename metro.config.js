// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// This machine has ~6 GB of RAM. Metro's default is one worker per CPU (12 here),
// and bundling web + Android at once ran Windows out of memory, which killed the
// dev server AND the terminal it shared. Two workers is slower to cold-start but
// stays well inside the budget.
config.maxWorkers = 2;

// Sibling projects that are not part of the app bundle. Without this Metro crawls
// and watches their node_modules / build output too (website/ alone is a full
// Next.js install).
const escape = (p) => p.replace(/[/\\]/g, '[/\\\\]');
const ignored = ['website', 'backend', 'dist', 'scripts', 'docs', 'screenshot', 'app-store'].map(
  (dir) => new RegExp(`^${escape(path.join(__dirname, dir))}[/\\\\].*`),
);
config.resolver.blockList = [
  ...(Array.isArray(config.resolver.blockList)
    ? config.resolver.blockList
    : config.resolver.blockList
      ? [config.resolver.blockList]
      : []),
  ...ignored,
];

module.exports = config;
