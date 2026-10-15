'use strict';
module.exports = {
  async up(q, S) { await q.addColumn('locations', 'note', { type: S.TEXT, allowNull: true }); },
  async down(q) { await q.removeColumn('locations', 'note'); },
};
