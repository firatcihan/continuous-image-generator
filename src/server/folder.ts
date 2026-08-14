import { execFile } from 'node:child_process';

export interface Command {
  command: string;
  args: string[];
}

export function folderCommand(platform: NodeJS.Platform, path: string): Command {
  if (platform === 'darwin') return { command: 'open', args: ['-R', path] };
  if (platform === 'win32') return { command: 'explorer', args: [path] };
  return { command: 'xdg-open', args: [path] };
}

/**
 * A separate command for URLs: on macOS `open -R` reveals the file in Finder,
 * it does not open a browser. On Windows `start` is a shell builtin so
 * `cmd /c` is required; the second argument (empty string) satisfies `start`'s
 * window-title expectation, otherwise the URL would be taken as the title.
 */
export function urlCommand(platform: NodeJS.Platform, url: string): Command {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

/** No shell string involved; the path travels as an argument array, no injection surface. */
export function openFolder(path: string): void {
  run(folderCommand(process.platform, path));
}

export function openUrl(url: string): void {
  run(urlCommand(process.platform, url));
}

function run({ command, args }: Command): void {
  execFile(command, args, () => {
    // silently ignore failure to open; not a critical path, the user can copy the address from the terminal
  });
}
