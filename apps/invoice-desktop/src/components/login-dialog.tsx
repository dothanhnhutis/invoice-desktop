import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { useEffect, useState } from "react";
import * as z from "zod";
import { useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { invoke } from "@tauri-apps/api/core";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "./ui/input";

const formSchema = z.object({
  username: z.string().min(1, "Bắt buộc"),
  password: z.string().min(1, "Bắt buộc"),
  floor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD"),
});

export type LoginForm = z.infer<typeof formSchema>;

const LoginDialog = () => {
  const navigate = useNavigate();
  const [loginError, setLoginError] = useState<string | null>(null);

  const form = useForm({
    defaultValues: {
      username: "",
      password: "",
      floor: "",
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      setLoginError(null); // xóa lỗi cũ trước mỗi lần thử
      try {
        // 1) Đăng nhập (giải captcha ở backend). Sai mật khẩu -> throw, DỪNG tại đây.
        await invoke<string>("login", {
          username: value.username,
          password: value.password,
        });
        // 2) Chỉ khi login OK mới đặt FLOOR rồi lưu credential (set_credentials kích sync).
        await invoke("set_floor", { date: value.floor });
        await invoke("set_credentials", {
          username: value.username,
          password: value.password,
        });
        // 3) Vào app; guard _protected pass vì has_credentials giờ = true.
        navigate({ to: "/lookups/invoice/purchase" });
      } catch (e) {
        // invoke reject bằng String (Err của Result<_, String> ở Rust).
        setLoginError(typeof e === "string" ? e : String(e));
      }
    },
  });

  useEffect(() => {
    // Prefill FLOOR đã lưu (nếu có).
    invoke<string>("get_floor")
      .then((v) => {
        if (v) form.setFieldValue("floor", v);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AlertDialog defaultOpen={true}>
      <AlertDialogContent
        render={
          <form
            className={"flex flex-col gap-6"}
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          />
        }
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Cài đặt tài khoản</AlertDialogTitle>
          <AlertDialogDescription>
            Nhập các thông tin bên dưới để đồng bộ dữ liệu từ thuế
            https://hoadondientu.gdt.gov.vn
          </AlertDialogDescription>
        </AlertDialogHeader>

        <FieldGroup>
          <form.Field
            name="username"
            children={(field) => {
              return (
                <Field>
                  <FieldLabel htmlFor={field.name}>Mã số thuế</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    type="text"
                    placeholder="0123456789"
                    required
                  />
                </Field>
              );
            }}
          />

          <form.Field
            name="password"
            children={(field) => {
              return (
                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor={field.name}>Mật khẩu</FieldLabel>
                  </div>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    type="password"
                    required
                    placeholder="********"
                  />
                </Field>
              );
            }}
          />

          <form.Field
            name="floor"
            children={(field) => {
              return (
                <Field>
                  <div className="flex items-center">
                    <FieldLabel htmlFor={field.name}>
                      Ngày đăng ký công ty
                    </FieldLabel>
                  </div>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    type="date"
                    required
                  />
                </Field>
              );
            }}
          />

          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting]}
            children={([canSubmit, isSubmitting]) => (
              <AlertDialogFooter>
                <AlertDialogAction
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full"
                >
                  {isSubmitting ? "..." : "Lưu & Đồng bộ"}
                </AlertDialogAction>
              </AlertDialogFooter>
            )}
          />
        </FieldGroup>

        {loginError && (
          <div className="mt-6 rounded-md border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-500">
            {loginError}
          </div>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
};

export default LoginDialog;
