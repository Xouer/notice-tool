/** CLI 失败（带契约退出码）/ CLI failure with contract exit code. */
export class CliFailure extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "CliFailure";
  }
}
