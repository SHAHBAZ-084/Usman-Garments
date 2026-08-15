import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';

export type CreateCustomLabelPresetInput = {
  rollType: string;
  widthMm: number;
  heightMm: number;
  rollWidthMm?: number;
  rollHeightMm?: number;
  rollGapMm?: number;
};

function assertPrintMm(value: number, field: string) {
  if (!Number.isInteger(value) || value < 10 || value > 200) {
    throw new AppError(400, `${field} must be an integer between 10 and 200 mm`);
  }
}

function assertOptionalRollMm(value: number | undefined, field: string, min: number, max: number) {
  if (value === undefined) return;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new AppError(400, `${field} must be an integer between ${min} and ${max} mm`);
  }
}

export async function listCustomLabelPresets() {
  return prisma.customLabelPreset.findMany({
    orderBy: { createdAt: 'asc' },
  });
}

export async function createCustomLabelPreset(input: CreateCustomLabelPresetInput) {
  const rollType = input.rollType.trim();
  if (!rollType || rollType.length > 40) {
    throw new AppError(400, 'Roll type must be 1–40 characters');
  }

  assertPrintMm(input.widthMm, 'Print width');
  assertPrintMm(input.heightMm, 'Print height');
  assertOptionalRollMm(input.rollWidthMm, 'Roll width', 10, 200);
  assertOptionalRollMm(input.rollHeightMm, 'Roll height', 10, 200);
  assertOptionalRollMm(input.rollGapMm, 'Roll gap', 0, 20);

  const key = `${input.widthMm}x${input.heightMm}-${Date.now()}`;
  const label = `${input.widthMm} × ${input.heightMm} mm (${rollType})`;

  return prisma.customLabelPreset.create({
    data: {
      key,
      label,
      rollType,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      rollWidthMm: input.rollWidthMm ?? null,
      rollHeightMm: input.rollHeightMm ?? null,
      rollGapMm: input.rollGapMm ?? null,
    },
  });
}

export async function deleteCustomLabelPreset(id: number) {
  try {
    return await prisma.customLabelPreset.delete({ where: { id } });
  } catch {
    throw new AppError(404, 'Custom label preset not found');
  }
}
