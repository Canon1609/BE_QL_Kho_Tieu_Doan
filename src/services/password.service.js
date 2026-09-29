const bcrypt = require('bcryptjs');
const { sequelize } = require('../models');

const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 72;
const failure = (status, message) => Object.assign(new Error(message), { status });

async function replacePassword(user, password) {
  if (!validPassword(password)) throw failure(400, 'Password must be 12–72 characters');
  if (await bcrypt.compare(password, user.password_hash)) throw failure(400, 'New password must differ from old password');
  const hash = await bcrypt.hash(password, 12);
  await sequelize.transaction(async transaction => {
    await user.update({ password_hash: hash, auth_version: sequelize.literal('auth_version + 1') }, { transaction });
  });
}

module.exports = { validPassword, replacePassword, failure };
