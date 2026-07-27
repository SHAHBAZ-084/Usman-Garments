/** Legacy Maal Khata category guard — products module removed; category may exist on old DBs. */
export const MAAL_KHATA_CATEGORY_NAME = 'Maal Khata';

export function isMaalKhataCategoryName(name: string) {
  return name === MAAL_KHATA_CATEGORY_NAME;
}

export async function assertNotMaalKhataLinkedAccount(_accountId: number) {
  // No product linkage in garments accounting core.
}
