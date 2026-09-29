module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('users', 'auth_version', { type: Sequelize.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 });
    await queryInterface.addColumn('users', 'google_sub', { type: Sequelize.STRING(255), allowNull: true, unique: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'google_sub');
    await queryInterface.removeColumn('users', 'auth_version');
  },
};
