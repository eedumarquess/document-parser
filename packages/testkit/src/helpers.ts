export const createPdfBuffer = (pages: number, body = 'hello world'): Buffer => {
  const pageMarkers = Array.from({ length: pages }, () => '/Type /Page').join('\n');
  return Buffer.from(`%PDF-1.4\n${pageMarkers}\n${body}`);
};

export const createPngBuffer = (body = 'png-text'): Buffer => Buffer.from(body, 'utf8');
export const createJpegBuffer = (body = 'jpeg-text'): Buffer => Buffer.from(body, 'utf8');

