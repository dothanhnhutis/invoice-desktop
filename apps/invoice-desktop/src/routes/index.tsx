import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import * as z from "zod";

export const Route = createFileRoute("/")({
  component: RouteComponent,
});

const formSchema = z.object({
  username: z.string().min(1, "Bắt buộc"),
  password: z.string().min(1, "Bắt buộc"),
  floor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày dạng YYYY-MM-DD"),
});

/** Payload event `sync://progress` (khớp struct SyncProgress ở Rust). */
type SyncProgress = {
  phase: string;
  oldest: string | null;
  newest: string | null;
  saved: number;
  total_in_db: number;
};

function RouteComponent() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<SyncProgress | null>(null);

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
    const unlisteners: UnlistenFn[] = [];
    listen<SyncProgress>("sync://progress", (e) => setProgress(e.payload)).then(
      (u) => unlisteners.push(u),
    );
    listen<string>("sync://error", (e) =>
      setStatus(`Lỗi đồng bộ: ${e.payload}`),
    ).then((u) => unlisteners.push(u));

    // Prefill FLOOR đã lưu (nếu có).
    invoke<string>("get_floor")
      .then((v) => {
        if (v) form.setFieldValue("floor", v);
      })
      .catch(() => {});

    return () => unlisteners.forEach((u) => u());
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

        {(status || progress) && (
          <div className="mt-6 rounded-md border p-3 text-sm">
            {status && <p className="font-medium">{status}</p>}
            {progress && (
              <div className="mt-1 text-muted-foreground">
                <p>
                  Pha: {progress.phase} · đã lưu lượt này: {progress.saved}
                </p>
                <p>
                  Khoảng: {progress.oldest ?? "?"} → {progress.newest ?? "?"}
                </p>
                <p>Tổng trong máy: {progress.total_in_db}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
