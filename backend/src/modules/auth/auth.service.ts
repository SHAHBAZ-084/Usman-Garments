import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../utils/helpers';

type UserRow = {
  id: number;
  username: string;
  displayName: string | null;
  role: string | null;
  passwordHash: string;
};

function toPublicUser(user: {
  id: number;
  username: string;
  displayName: string | null;
  role: string | null;
}) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    role: user.role?.trim() || 'Owner',
  };
}

async function findUserByUsername(username: string): Promise<UserRow | null> {
  const rows = await prisma.$queryRaw<UserRow[]>`
    SELECT id, username, displayName, role, passwordHash
    FROM User
    WHERE username = ${username}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function findUserById(id: number): Promise<UserRow | null> {
  const rows = await prisma.$queryRaw<UserRow[]>`
    SELECT id, username, displayName, role, passwordHash
    FROM User
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function login(username: string, password: string) {
  const user = await findUserByUsername(username);

  if (!user) {
    return null;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return null;
  }

  return toPublicUser(user);
}

export async function getUserById(id: number) {
  const user = await findUserById(id);

  if (!user) {
    return null;
  }

  return toPublicUser(user);
}

export type UpdateProfileInput = {
  displayName?: string;
  role?: string;
  username?: string;
  currentPassword?: string;
  newPassword?: string;
};

/** Verify the signed-in user's current password before allowing a password change. */
export async function verifyCurrentPassword(userId: number, currentPassword: string) {
  if (!currentPassword) {
    throw new AppError(400, 'Current password is required');
  }
  const user = await findUserById(userId);
  if (!user) {
    throw new AppError(404, 'User not found');
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new AppError(400, 'Current password is incorrect');
  }
  return { ok: true as const };
}

export async function updateProfile(userId: number, input: UpdateProfileInput) {
  const user = await findUserById(userId);
  if (!user) {
    throw new AppError(404, 'User not found');
  }

  const nextUsername = input.username?.trim();
  const newPassword = input.newPassword?.trim() ? input.newPassword : undefined;
  const usernameChanging = Boolean(nextUsername && nextUsername !== user.username);
  const passwordChanging = Boolean(newPassword);

  if (passwordChanging || usernameChanging) {
    if (!input.currentPassword) {
      throw new AppError(400, 'Current password is required to change username or password');
    }
    const valid = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!valid) {
      throw new AppError(400, 'Current password is incorrect');
    }
  }

  if (passwordChanging) {
    if (!newPassword || newPassword.length < 6) {
      throw new AppError(400, 'New password must be at least 6 characters');
    }
    if (newPassword === input.currentPassword) {
      throw new AppError(400, 'New password must be different from the current password');
    }
  }

  if (usernameChanging) {
    if (!nextUsername || nextUsername.length < 3) {
      throw new AppError(400, 'Username must be at least 3 characters');
    }
    const taken = await findUserByUsername(nextUsername);
    if (taken && taken.id !== userId) {
      throw new AppError(400, 'Username is already taken');
    }
  }

  const displayName =
    input.displayName !== undefined
      ? input.displayName.trim() || nextUsername || user.username
      : user.displayName;
  const role = input.role !== undefined ? input.role.trim() || 'Owner' : user.role ?? 'Owner';
  const username = usernameChanging && nextUsername ? nextUsername : user.username;
  const passwordHash = passwordChanging && newPassword
    ? await bcrypt.hash(newPassword, 10)
    : user.passwordHash;

  await prisma.$executeRaw`
    UPDATE User
    SET
      displayName = ${displayName},
      role = ${role},
      username = ${username},
      passwordHash = ${passwordHash},
      updatedAt = CURRENT_TIMESTAMP
    WHERE id = ${userId}
  `;

  const updated = await findUserById(userId);
  if (!updated) {
    throw new AppError(404, 'User not found');
  }
  return toPublicUser(updated);
}
