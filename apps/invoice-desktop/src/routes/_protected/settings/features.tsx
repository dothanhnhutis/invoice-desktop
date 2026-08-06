import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  api,
  CREDENTIAL_USERNAME_KEY,
  FEATURE_INVOICE_KEY,
  FEATURE_RAW_MATERIALS_KEY,
  FLOOR_KEY,
  SYNC_STATUS_KEY,
} from "@/lib/api";
import { useSync } from "@/contexts/sync-context";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { format } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { vi } from "react-day-picker/locale";
import { toast } from "sonner";
import * as z from "zod";

export const Route = createFileRoute("/_protected/settings/features")({
  component: RouteComponent,
});

const formSchema = z.object({
  username: z.string().min(1, "Bắt buộc"),
  password: z.string().min(1, "Bắt buộc"),
});

/** yyyy-MM-dd (đầu ngày, giờ máy) -> Date để hiển thị trên Calendar. */
const parseYmd = (s: string) => new Date(`${s}T00:00:00`);

/** Lỗi từ Rust là Err(String); các lỗi khác stringify. */
const errText = (e: unknown) => (typeof e === "string" ? e : String(e));

function RouteComponent() {
  const qc = useQueryClient();

  // ---- Module nguyên liệu & COA ----
  const rmQ = useQuery({
    queryKey: FEATURE_RAW_MATERIALS_KEY,
    queryFn: api.getFeatureRawMaterials,
  });
  const rmEnabled = rmQ.data ?? true;
  const [rmConfirmOpen, setRmConfirmOpen] = useState(false);
  const rmMut = useMutation({
    mutationFn: (enabled: boolean) => api.setFeatureRawMaterials(enabled),
    onSuccess: (_data, enabled) => {
      qc.invalidateQueries({ queryKey: FEATURE_RAW_MATERIALS_KEY });
      qc.invalidateQueries({ queryKey: ["raw_materials"] });
      qc.invalidateQueries({ queryKey: ["coas"] });
      toast.success(
        enabled
          ? "Đã bật quản lý nguyên liệu & COA"
          : "Đã tắt và xoá toàn bộ dữ liệu nguyên liệu & COA",
      );
    },
    onError: (e) => toast.error(String(e)),
  });

  // ---- Module hoá đơn (bật ⟺ có credential GDT) ----
  const invoiceQ = useQuery({
    queryKey: FEATURE_INVOICE_KEY,
    queryFn: api.getFeatureInvoice,
  });
  const invoiceEnabled = invoiceQ.data ?? false;
  const [showInvoiceForm, setShowInvoiceForm] = useState(false);
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false);

  const disableInvoiceMut = useMutation({
    mutationFn: () => api.disableInvoices(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: FEATURE_INVOICE_KEY });
      qc.invalidateQueries({ queryKey: CREDENTIAL_USERNAME_KEY });
      qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Đã tắt và xoá toàn bộ hoá đơn");
    },
    onError: (e) => toast.error(String(e)),
  });

  return (
    <FieldGroup className="max-w-xl">
      <FieldSet>
        <FieldLegend>Cài đặt tính năng</FieldLegend>
        <FieldDescription>
          Cho phép bật/tắt các tính năng của ứng dụng.
        </FieldDescription>
      </FieldSet>

      <FieldSeparator />

      {/* ---- Nguyên liệu & COA ---- */}
      <FieldSet>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="raw-material">
                Quản lý nguyên liệu
              </FieldLabel>
              <FieldDescription>
                Quản lý danh sách nguyên liệu và giấy chứng nhận phân tích
                (Certificate of Analysis).
              </FieldDescription>
            </FieldContent>
            <Switch
              id="raw-material"
              checked={rmEnabled}
              disabled={rmQ.isLoading || rmMut.isPending}
              onCheckedChange={(v) =>
                v ? rmMut.mutate(true) : setRmConfirmOpen(true)
              }
            />
          </Field>
        </FieldGroup>
      </FieldSet>

      <AlertDialog open={rmConfirmOpen} onOpenChange={setRmConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tắt quản lý nguyên liệu & COA?</AlertDialogTitle>
            <AlertDialogDescription>
              Toàn bộ nguyên liệu, COA và file COA sẽ bị xoá vĩnh viễn và không
              thể khôi phục.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              disabled={rmMut.isPending}
              onClick={async () => {
                await rmMut.mutateAsync(false);
                setRmConfirmOpen(false);
              }}
            >
              Xoá & tắt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <FieldSeparator />

      {/* ---- Hoá đơn ---- */}
      <FieldSet>
        <FieldGroup>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="invoice">
                Quản lý hoá đơn đầu vào/ra
              </FieldLabel>
              <FieldDescription>
                Quản lý danh sách hoá đơn đầu vào/ra từ
                https://hoadondientu.gdt.gov.vn
              </FieldDescription>
            </FieldContent>
            <Switch
              id="invoice"
              checked={invoiceEnabled}
              disabled={invoiceQ.isLoading || disableInvoiceMut.isPending}
              onCheckedChange={(v) => {
                if (v) setShowInvoiceForm(true);
                else setInvoiceConfirmOpen(true);
              }}
            />
          </Field>
        </FieldGroup>

        {/* Đã bật: trạng thái đồng bộ + form cập nhật mật khẩu/mốc thời gian. */}
        {invoiceEnabled && <InvoiceEnabledPanel />}

        {/* Chưa bật + vừa gạt bật: hiện form đăng nhập GDT. */}
        {!invoiceEnabled && showInvoiceForm && (
          <InvoiceEnableForm onDone={() => setShowInvoiceForm(false)} />
        )}
      </FieldSet>

      <AlertDialog
        open={invoiceConfirmOpen}
        onOpenChange={setInvoiceConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Tắt quản lý hoá đơn?</AlertDialogTitle>
            <AlertDialogDescription>
              Toàn bộ hoá đơn đã tải sẽ bị xoá và bạn cần đăng nhập lại để bật
              tính năng này.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              disabled={disableInvoiceMut.isPending}
              onClick={async () => {
                await disableInvoiceMut.mutateAsync();
                setInvoiceConfirmOpen(false);
              }}
            >
              Xoá & tắt
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldGroup>
  );
}

/** Form bật module: xác minh MST/mật khẩu rồi mới lưu credential + floor. */
function InvoiceEnableForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState<Date>();
  const [loginError, setLoginError] = useState<string | null>(null);

  // Prefill ngày thành lập từ floor đã lưu (yyyy-MM-dd).
  const floorQ = useQuery({ queryKey: FLOOR_KEY, queryFn: api.getFloor });
  useEffect(() => {
    if (floorQ.data && !date) setDate(parseYmd(floorQ.data));
  }, [floorQ.data, date]);

  const form = useForm({
    defaultValues: { username: "", password: "" },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      setLoginError(null);
      if (!date) {
        setLoginError("Vui lòng chọn ngày thành lập công ty");
        return;
      }
      try {
        // ⚠️ Xác minh trước (gửi 1 lần): sai mật khẩu -> throw, KHÔNG lưu credential.
        await invoke("login", {
          username: value.username,
          password: value.password,
        });
        await invoke("set_floor", { date: format(date, "yyyy-MM-dd") });
        await invoke("set_credentials", {
          username: value.username,
          password: value.password,
        });
        qc.invalidateQueries({ queryKey: FEATURE_INVOICE_KEY });
        qc.invalidateQueries({ queryKey: CREDENTIAL_USERNAME_KEY });
        qc.invalidateQueries({ queryKey: FLOOR_KEY });
        qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
        qc.invalidateQueries({ queryKey: ["invoices"] });
        onDone();
        toast.success("Đã bật hoá đơn — bắt đầu đồng bộ");
      } catch (e) {
        setLoginError(errText(e));
      }
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field
          name="username"
          children={(field) => (
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
              <FieldDescription>
                Mã số thuế tài khoản https://hoadondientu.gdt.gov.vn
              </FieldDescription>
            </Field>
          )}
        />

        <form.Field
          name="password"
          children={(field) => (
            <Field>
              <FieldLabel htmlFor={field.name}>Mật khẩu</FieldLabel>
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
              <FieldDescription>
                Mật khẩu tài khoản https://hoadondientu.gdt.gov.vn
              </FieldDescription>
            </Field>
          )}
        />

        <Field>
          <FieldLabel>Ngày thành lập công ty</FieldLabel>
          <FloorDatePicker
            date={date}
            onChange={setDate}
            placeholder="Ngày thành lập công ty"
          />
          <FieldDescription>
            Mốc thời gian để ứng dụng bắt đầu đồng bộ hoá đơn.
          </FieldDescription>
        </Field>

        {loginError && (
          <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-sm text-red-500">
            {loginError}
          </div>
        )}

        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting]}
          children={([canSubmit, isSubmitting]) => (
            <Field orientation="horizontal">
              <Button
                type="submit"
                disabled={!canSubmit || !date}
                className="w-full"
              >
                {isSubmitting && <Spinner />}
                Đăng nhập & đồng bộ
              </Button>
            </Field>
          )}
        />
      </FieldGroup>
    </form>
  );
}

/** Đã bật: tiến độ/trạng thái đồng bộ + cập nhật mật khẩu mới và mốc thời gian. */
function InvoiceEnabledPanel() {
  const qc = useQueryClient();
  const { progress, error, busy } = useSync(); // realtime từ event sync://*

  const sync = useQuery({
    queryKey: SYNC_STATUS_KEY,
    queryFn: api.getSyncStatus,
    refetchInterval: 3000,
  });
  const usernameQ = useQuery({
    queryKey: CREDENTIAL_USERNAME_KEY,
    queryFn: api.getUsername,
  });
  const floorQ = useQuery({ queryKey: FLOOR_KEY, queryFn: api.getFloor });

  const [password, setPassword] = useState("");
  const [date, setDate] = useState<Date>();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Prefill mốc thời gian đã lưu (chỉ khi người dùng chưa tự chọn).
  useEffect(() => {
    if (floorQ.data && !date) setDate(parseYmd(floorQ.data));
  }, [floorQ.data, date]);

  const floorChanged =
    !!date && !!floorQ.data && format(date, "yyyy-MM-dd") !== floorQ.data;
  const dirty = password.trim().length > 0 || floorChanged;

  const lastSync = sync.data?.last_sync_at
    ? new Date(sync.data.last_sync_at * 1000).toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
      })
    : "chưa";

  const onSave = async () => {
    setSaveError(null);
    // Đang đồng bộ: set_floor bị backend chặn (race sync_state) -> chặn sớm ở đây.
    if (busy) {
      setSaveError("Đang đồng bộ, vui lòng thử lại sau khi đồng bộ xong");
      return;
    }
    const username = usernameQ.data;
    const pwd = password.trim();
    if (pwd && !username) {
      setSaveError("Không đọc được mã số thuế đã lưu");
      return;
    }
    setSaving(true);
    try {
      if (pwd) {
        // ⚠️ Gửi 1 lần duy nhất, KHÔNG retry: sai mật khẩu nhiều lần -> khoá tài khoản.
        await invoke("login", { username, password: pwd });
        await invoke("set_credentials", { username, password: pwd });
        setPassword("");
      }
      if (date && floorChanged) {
        await invoke("set_floor", { date: format(date, "yyyy-MM-dd") });
        qc.invalidateQueries({ queryKey: FLOOR_KEY });
        qc.invalidateQueries({ queryKey: ["invoices"] }); // set_floor có thể prune
      }
      qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY });
      toast.success("Đã lưu thay đổi");
    } catch (err) {
      setSaveError(errText(err));
      setPassword("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FieldGroup>
      {/* --- Trạng thái đồng bộ --- */}
      {error && (
        <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </div>
      )}
      {progress && !error && (
        <div className="rounded-xl border p-3 text-sm text-muted-foreground">
          Đang đồng bộ ({progress.phase}) · lưu lượt này: {progress.saved} ·
          tổng: {progress.total_in_db}
        </div>
      )}
      <div className="rounded-xl border p-3 text-sm text-muted-foreground">
        <p>
          Tải lịch sử:{" "}
          <b>
            {sync.data
              ? sync.data.backfill_done
                ? "đã xong"
                : "đang chạy"
              : "…"}
          </b>
        </p>
        <p>
          Khoảng đã tải: {sync.data?.oldest_date ?? "?"} →{" "}
          {sync.data?.newest_date ?? "?"}
        </p>
        <p>Đồng bộ gần nhất: {lastSync}</p>
      </div>

      {/* --- Cập nhật mật khẩu / mốc thời gian (khoá khi đang đồng bộ) --- */}
      {busy && (
        <p className="text-sm text-muted-foreground">
          Đang đồng bộ — không thể đổi mật khẩu hoặc mốc thời gian. Vui lòng đợi
          đồng bộ xong.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="invoice-username">Mã số thuế</FieldLabel>
            <Input
              id="invoice-username"
              value={usernameQ.data ?? ""}
              readOnly
              disabled
            />
            <FieldDescription>
              Đổi tài khoản: tắt rồi bật lại tính năng này.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="invoice-new-password">Mật khẩu mới</FieldLabel>
            <Input
              id="invoice-new-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
              autoComplete="new-password"
              disabled={busy}
            />
            <FieldDescription>
              Để trống nếu không đổi. Mật khẩu sẽ được kiểm tra trước khi lưu.
            </FieldDescription>
          </Field>

          <Field>
            <FieldLabel>Ngày thành lập công ty</FieldLabel>
            <FloorDatePicker
              date={date}
              onChange={setDate}
              placeholder="Chọn ngày"
              disabled={busy}
            />
            <FieldDescription>
              Mốc thời gian đồng bộ. Chọn sớm hơn để tải thêm hoá đơn cũ; chọn
              muộn hơn sẽ XOÁ hoá đơn trước mốc.
            </FieldDescription>
          </Field>

          {saveError && (
            <div className="rounded-xl border border-red-500 bg-red-500/10 p-3 text-sm text-red-500">
              {saveError}
            </div>
          )}

          <Field orientation="horizontal">
            <Button
              type="submit"
              disabled={!dirty || saving || busy}
              className="w-full"
            >
              {saving && <Spinner />}
              Lưu thay đổi
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </FieldGroup>
  );
}

/** Popover + Calendar chọn mốc thời gian (không cho ngày tương lai). */
function FloorDatePicker({
  date,
  onChange,
  placeholder,
  disabled,
}: {
  date: Date | undefined;
  onChange: (d: Date | undefined) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            data-empty={!date}
            className="w-[212px] justify-between text-left font-normal data-[empty=true]:text-muted-foreground"
          >
            {date ? format(date, "dd/MM/yyyy") : <span>{placeholder}</span>}
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={date}
          onSelect={onChange}
          defaultMonth={date}
          disabled={{ after: new Date() }}
          locale={vi}
          fixedWeeks
        />
      </PopoverContent>
    </Popover>
  );
}
