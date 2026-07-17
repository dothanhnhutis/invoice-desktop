import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useSync } from "@/components/sync-provider";
import * as z from "zod";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

const formSchema = z.object({
  username: z.string().min(1, "Bắt buộc"),
  password: z.string().min(1, "Bắt buộc"),
  floor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD"),
});

export type LoginForm = z.infer<typeof formSchema>;

function RouteComponent() {
  const navigate = useNavigate();
  const { error } = useSync(); // lỗi đồng bộ toàn cục (listener ở __root)
  const [status, setStatus] = useState<string>("");

  const form = useForm({
    defaultValues: {
      username: "",
      password: "",
      floor: "2026-07-01",
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        // Đặt FLOOR trước để backfill chạy đúng mốc, rồi lưu credential (kích sync).
        await invoke("set_floor", { date: value.floor });
        await invoke("set_credentials", {
          username: value.username,
          password: value.password,
        });
        setStatus("Đã lưu. Đang đồng bộ…");
        navigate({ to: "/purchase" });
      } catch (e) {
        setStatus(`Lỗi: ${e}`);
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
    <div className="flex flex-1 items-center justify-center h-screen">
      <div className="w-full max-w-xs">
        <form
          className={"flex flex-col gap-6"}
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <div className="flex flex-col items-center gap-1 text-center">
              <h1 className="text-2xl font-bold">Cài đặt Credential</h1>
            </div>
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
                <Field>
                  <Button type="submit" disabled={!canSubmit}>
                    {isSubmitting ? "..." : "Lưu & Đồng bộ"}
                  </Button>
                </Field>
              )}
            />
          </FieldGroup>
        </form>

        {(status || error) && (
          <div className="mt-6 rounded-md border p-3 text-sm">
            {status && <p className="font-medium">{status}</p>}
            {error && <p className="mt-1 text-red-500">{error}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
