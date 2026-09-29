"use strict";

const bcrypt = require('bcryptjs');
require('dotenv').config({ quiet: true });

module.exports = {
  async up(queryInterface) {
    const [existing] = await queryInterface.sequelize.query('SELECT id FROM users WHERE username = :username LIMIT 1', { replacements: { username: 'admin' } });
    if (existing.length) return; // Never reset an existing account or its password.
    const password = process.env.INITIAL_ADMIN_PASSWORD;
    if (typeof password !== 'string' || password.length < 12 || password.length > 72) {
      throw new Error('INITIAL_ADMIN_PASSWORD is required (12–72 characters) to seed the first admin');
    }
    const [roles] = await queryInterface.sequelize.query('SELECT id FROM roles WHERE code = :code LIMIT 1', { replacements: { code: 'BATTALION_ADMIN' } });
    const [units] = await queryInterface.sequelize.query('SELECT id FROM units WHERE code = :code AND type = :type AND parent_id IS NULL AND is_active = 1 LIMIT 1', { replacements: { code: 'BATTALION_5', type: 'BATTALION' } });
    if (!roles.length || !units.length) throw new Error('Seed roles and active battalion root before initial admin');
    const now = new Date();
    await queryInterface.bulkInsert('users', [{ username: 'admin', full_name: 'Quản trị Tiểu đoàn', password_hash: await bcrypt.hash(password, 12), role_id: roles[0].id, unit_id: units[0].id, is_active: true, last_login_at: null, created_at: now, updated_at: now }]);
  },
  // Never delete an administrator when rolling back seeders.
  async down() {},
};
