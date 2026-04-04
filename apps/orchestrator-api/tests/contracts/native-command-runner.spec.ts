import { NativeCommandRunner } from '@document-parser/shared-infrastructure';

describe('NativeCommandRunner contract', () => {
  it('preserves native failure diagnostics when a command exits non-zero', async () => {
    const runner = new NativeCommandRunner();

    await expect(
      runner.run(process.execPath, [
        '-e',
        'process.stdout.write("stdout-out"); process.stderr.write("stderr-out"); process.exit(2);'
      ])
    ).rejects.toMatchObject({
      metadata: expect.objectContaining({
        command: process.execPath,
        args: ['-e', 'process.stdout.write("stdout-out"); process.stderr.write("stderr-out"); process.exit(2);'],
        code: 2,
        stdout: 'stdout-out',
        stderr: 'stderr-out'
      })
    });
  });
});
