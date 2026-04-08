/**
 * RBAC Service — Role-based Access Control
 *
 * In-memory user and role management with permission checking.
 */

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: Date;
}

interface Role {
  id: string;
  name: string;
  permissions: string[];
  created_at: Date;
}

// In-memory stores
let users = new Map<string, User>();
let roles = new Map<string, Role>();

// Predefined system roles
const SYSTEM_ROLES: Record<string, string[]> = {
  admin: [
    "user.create",
    "user.read",
    "user.update",
    "user.delete",
    "role.create",
    "role.read",
    "role.update",
    "role.delete",
    "audit.read",
    "incident.create",
    "incident.read",
    "incident.update",
    "incident.resolve",
    "incident.escalate",
    "slo.read",
    "slo.create",
    "backup.create",
    "backup.read",
  ],
  operator: [
    "user.read",
    "audit.read",
    "incident.read",
    "incident.update",
    "incident.resolve",
    "slo.read",
    "backup.create",
    "backup.read",
  ],
  viewer: [
    "user.read",
    "audit.read",
    "incident.read",
    "slo.read",
  ],
};

/**
 * Initialize system roles on module load
 */
function initializeSystemRoles() {
  for (const [roleName, permissions] of Object.entries(SYSTEM_ROLES)) {
    const roleId = `rol_${roleName}`;
    if (!roles.has(roleId)) {
      roles.set(roleId, {
        id: roleId,
        name: roleName,
        permissions,
        created_at: new Date(),
      });
    }
  }
}

initializeSystemRoles();

/**
 * Generate user ID with usr_ prefix
 */
function generateUserId(): string {
  return `usr_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate role ID with rol_ prefix
 */
function generateRoleId(): string {
  return `rol_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create a new user
 */
export function createUser(email: string, name: string, role: string): User {
  // Check if user already exists
  const existing = Array.from(users.values()).find((u) => u.email === email);
  if (existing) {
    throw new Error(`User with email ${email} already exists`);
  }

  // Verify role exists
  const roleFound = Array.from(roles.values()).find((r) => r.name === role);
  if (!roleFound) {
    throw new Error(`Role ${role} does not exist`);
  }

  const user: User = {
    id: generateUserId(),
    email,
    name,
    role,
    created_at: new Date(),
  };

  users.set(user.id, user);
  return user;
}

/**
 * Get user by ID
 */
export function getUser(id: string): User | undefined {
  return users.get(id);
}

/**
 * List all users
 */
export function listUsers(): User[] {
  return Array.from(users.values());
}

/**
 * Create a new role with custom permissions
 */
export function createRole(name: string, permissions: string[]): Role {
  // Check if role already exists
  const existing = Array.from(roles.values()).find((r) => r.name === name);
  if (existing) {
    throw new Error(`Role ${name} already exists`);
  }

  const role: Role = {
    id: generateRoleId(),
    name,
    permissions,
    created_at: new Date(),
  };

  roles.set(role.id, role);
  return role;
}

/**
 * Get role by ID
 */
export function getRole(id: string): Role | undefined {
  return roles.get(id);
}

/**
 * List all roles
 */
export function listRoles(): Role[] {
  return Array.from(roles.values());
}

/**
 * Check if user has permission
 */
export function checkPermission(userId: string, permission: string): boolean {
  const user = getUser(userId);
  if (!user) {
    return false;
  }

  const role = Array.from(roles.values()).find((r) => r.name === user.role);
  if (!role) {
    return false;
  }

  return role.permissions.includes(permission);
}

/**
 * Clear all data (for testing)
 */
export function _clearAll() {
  users.clear();
  roles.clear();
  initializeSystemRoles();
}
