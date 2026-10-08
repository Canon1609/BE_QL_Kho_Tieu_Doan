const express = require("express");
const cors = require("cors");
const healthRoutes = require("./routes/health.routes");
const authRoutes = require("./routes/auth.routes");
const usersRoutes = require("./routes/users.routes");
const materialMasterRoutes = require('./routes/material-master.routes');
const stockRoutes = require('./routes/stock.routes');
const transferRoutes = require('./routes/transfer.routes');
const { notFound, errorHandler } = require("./middlewares/error.middleware");

const app = express();
app.use(cors());
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api/v1", healthRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/users", usersRoutes);
app.use('/api/v1/catalog', materialMasterRoutes);
app.use('/api/v1/stock', stockRoutes);
app.use('/api/v1/transfers', transferRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
