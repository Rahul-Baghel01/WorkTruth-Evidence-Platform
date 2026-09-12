import { Router, type IRouter } from "express";
import healthRouter from "./health";
import worktruthRouter from "./worktruth";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(worktruthRouter);
router.use(adminRouter);

export default router;
