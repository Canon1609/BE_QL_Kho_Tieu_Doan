require('dotenv').config();
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const bcrypt = require('bcryptjs');
const { sequelize, User, Role, Unit } = require('../src/models');

async function run() {
  if (!stdin.isTTY) throw new Error('Interactive terminal required');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let password;
  try {
    const username = (await rl.question('Username: ')).trim();
    const fullName = (await rl.question('Full name: ')).trim();
    // Disable terminal echo while reading the password; no CLI args/env values or logging.
    rl.close();
    const hidden = readline.createInterface({ input: stdin, output: stdout, terminal: true });
    hidden._writeToOutput = (text) => { if (!hidden.hidden) stdout.write(text); };
    stdout.write('Password (min 12 characters): ');
    hidden.hidden = true;
    password = await hidden.question('');
    hidden.hidden = false;
    hidden.close();
    stdout.write('\n');
    if (!/^[a-zA-Z0-9._-]{3,100}$/.test(username) || !fullName || fullName.length > 150 || password.length < 12 || password.length > 72) throw new Error('Invalid input (username 3-100 safe characters, name 1-150, password 12-72)');
    const [role, unit] = await Promise.all([Role.findOne({ where: { code: 'BATTALION_ADMIN' } }), Unit.findOne({ where: { code: 'BATTALION_5' } })]);
    if (!role || !unit || unit.type !== 'BATTALION' || unit.parent_id !== null || !unit.is_active) throw new Error('Required role/root unit missing or invalid');
    if (await User.findOne({ where: { username } })) throw new Error('Username already exists');
    const count = await User.count({ where: { role_id: role.id } });
    if (count) throw new Error('Battalion admin already exists; bootstrap is only for the first admin');
    const password_hash = await bcrypt.hash(password, 12);
    password = undefined;
    await User.create({ username, full_name: fullName, password_hash, role_id: role.id, unit_id: unit.id });
    stdout.write('Battalion admin created.\n');
  } finally { password = undefined; rl.close(); await sequelize.close(); }
}
run().catch(() => { console.error('Admin creation failed. Check input, database configuration and existing records.'); process.exitCode = 1; });
