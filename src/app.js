const express = require("express");
const cors = require("cors");
const healthRoutes = require("./routes/health.routes");
const { notFound, errorHandler } = require("./middlewares/error.middleware");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api/v1", healthRoutes);
app.use(notFound);
app.use(errorHandler);

module.exports = app;
