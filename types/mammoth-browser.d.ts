declare module "mammoth/mammoth.browser" {
  type ExtractRawTextResult = {
    value: string;
    messages: Array<unknown>;
  };

  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<ExtractRawTextResult>;
}
