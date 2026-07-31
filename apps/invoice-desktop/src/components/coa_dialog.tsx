import React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Button } from "./ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "./ui/field";
import { Input } from "./ui/input";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as z from "zod";
import { PlusIcon } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { ApiError, api } from "@/lib/api";
import { isVnDate } from "@/lib/date";

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";

export type CoaDialogProps = {
  rawMaterialId: number;
};

const vnDate = z
  .string()
  .nullable()
  .refine((v) => !v || isVnDate(v), "Ngày dạng dd/mm/yyyy hoặc mm/yyyy.");

const formSchema = z.object({
  lot_no: z.string().min(1, "Số lô không được để trống."),
  manufacture_date: vnDate,
  expiration_date: vnDate,
});

const CoaDialog = ({ rawMaterialId }: CoaDialogProps) => {
  const [open, setOpen] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: {
      lot_no: "",
      manufacture_date: null as string | null,
      expiration_date: null as string | null,
    },
    validators: { onSubmit: formSchema },
    onSubmit: async ({ value }) => {
      if (!file) {
        setFileError("Vui lòng chọn file COA (ảnh hoặc PDF).");
        return;
      }
      const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
      await mutation.mutateAsync({
        raw_material_id: rawMaterialId,
        lot_no: value.lot_no,
        manufacture_date: value.manufacture_date || null,
        expiration_date: value.expiration_date || null,
        file_name: file.name,
        file_bytes: bytes,
      });
    },
  });

  const mutation = useMutation({
    mutationFn: api.createCoa,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coas", rawMaterialId] });
      toast.success("Đã tạo COA");
      setOpen(false);
      form.reset();
      setFile(null);
      setFileError(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : String(e));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline">
            <PlusIcon />
            <span className="hidden sm:inline">Thêm COA</span>
          </Button>
        }
      />
      <DialogContent
        className="sm:max-w-sm"
        render={
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>Thêm COA</DialogTitle>
          <DialogDescription>
            Thêm phiếu kiểm nghiệm kèm file (ảnh hoặc PDF).
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <form.Field
            name="lot_no"
            children={(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Số lô</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    placeholder="Số lô"
                    required
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />

          <form.Field
            name="manufacture_date"
            children={(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Ngày sản xuất</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value ?? ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value || null)}
                    aria-invalid={isInvalid}
                    placeholder="dd/mm/yyyy hoặc mm/yyyy"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />

          <form.Field
            name="expiration_date"
            children={(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Hạn sử dụng</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value ?? ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value || null)}
                    aria-invalid={isInvalid}
                    placeholder="dd/mm/yyyy hoặc mm/yyyy"
                  />
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />

          <Field data-invalid={!!fileError}>
            <FieldLabel htmlFor="coa-file">File COA</FieldLabel>
            <Input
              id="coa-file"
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              aria-invalid={!!fileError}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f && f.size > MAX_FILE_BYTES) {
                  setFile(null);
                  setFileError("File quá lớn (tối đa 20MB).");
                  return;
                }
                setFile(f);
                setFileError(null);
              }}
            />
            <FieldDescription>Ảnh (PNG/JPG/WebP) hoặc PDF.</FieldDescription>
            {fileError && <FieldError errors={[{ message: fileError }]} />}
          </Field>
        </FieldGroup>

        <form.Subscribe
          selector={(state) => [state.canSubmit, state.isSubmitting]}
          children={([canSubmit, isSubmitting]) => (
            <DialogFooter>
              <DialogClose
                render={
                  <Button disabled={isSubmitting} variant="outline">
                    Huỷ
                  </Button>
                }
              />
              <Button type="submit" disabled={!canSubmit || isSubmitting}>
                {isSubmitting && <Spinner />}
                Tạo
              </Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
};

export default CoaDialog;
