const { DataTypes } = require("sequelize");
const { getSequelize } = require("../config/database");

const sequelize = getSequelize();
const Role = require("./role.model")(sequelize, DataTypes);
const Unit = require("./unit.model")(sequelize, DataTypes);
const User = require("./user.model")(sequelize, DataTypes);
const master = require('./material-master.model')(sequelize, DataTypes);

Role.hasMany(User, { foreignKey: "role_id", as: "users", onDelete: "RESTRICT" });
User.belongsTo(Role, { foreignKey: "role_id", as: "role", onDelete: "RESTRICT" });
Unit.hasMany(User, { foreignKey: "unit_id", as: "users", onDelete: "RESTRICT" });
User.belongsTo(Unit, { foreignKey: "unit_id", as: "unit", onDelete: "RESTRICT" });
Unit.belongsTo(Unit, { foreignKey: "parent_id", as: "parent", onDelete: "RESTRICT" });
Unit.hasMany(Unit, { foreignKey: "parent_id", as: "children", onDelete: "RESTRICT" });

module.exports = { sequelize, Role, Unit, User, ...master };
