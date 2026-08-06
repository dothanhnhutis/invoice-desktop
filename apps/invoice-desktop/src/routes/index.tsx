import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  // App vào thẳng (không bắt buộc đăng nhập GDT). Đăng nhập/bật hoá đơn qua Cài đặt.
  beforeLoad: () => {
    throw redirect({ to: "/settings/features" });
  },
});
