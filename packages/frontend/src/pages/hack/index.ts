import { mount, lazy } from "navi";

export default {
  h: mount({
    "/:id": lazy(() => import("./HackDetailPage"))
  })
};
