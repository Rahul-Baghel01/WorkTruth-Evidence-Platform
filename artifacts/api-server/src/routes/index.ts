import { Router, type IRouter } from "express";
import healthRouter from "./health";
import worktruthRouter from "./worktruth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(worktruthRouter);

export default router;
