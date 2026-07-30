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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as z from "zod";
import { PencilIcon, PlusIcon } from "lucide-react";
import { Spinner } from "./ui/spinner";
import {
  ApiError,
  api,
  type NewRawMaterial,
  type RawMaterial,
} from "@/lib/api";

export type { RawMaterial };

const countries = [
  { label: "Chọn quốc gia", value: null },
  { label: "Việt Nam", value: "Việt Nam" },
  { label: "Trung Quốc", value: "Trung Quốc" },
  { label: "Ý", value: "Ý" },
  { label: "Hàn Quốc", value: "Hàn Quốc" },
];

export type RawMaterialDialogProps = {
  data?: RawMaterial;
  /** Phần tử mở dialog. Nếu không truyền và cũng không controlled → nút "Thêm nguyên liệu". */
  trigger?: React.ReactNode;
  /** Controlled open (dùng cho dialog sửa mở từ ngoài). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Gọi sau khi lưu thành công (vd để re-run router loader ở trang chi tiết). */
  onSaved?: () => void;
};

const formSchema = z.object({
  code: z
    .string()
    .regex(/^ICHRM-[0-9]{4}$/, "Mã nguyên liệu không hợp lệ. Ex: ICHRM-xxxx"),
  name: z.string().min(1, "Tên nguyên liệu không được để trống."),
  producer: z.string(),
  country_of_origin: z.string().nullable(),
});

export type RawMaterialForm = z.infer<typeof formSchema>;

const RawMaterialDialog = ({
  data,
  trigger,
  open: openProp,
  onOpenChange,
  onSaved,
}: RawMaterialDialogProps) => {
  const [openState, setOpenState] = React.useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openState;
  const setOpen = (o: boolean) => {
    if (!isControlled) setOpenState(o);
    onOpenChange?.(o);
  };

  const queryClient = useQueryClient();

  const form = useForm({
    defaultValues: {
      code: data?.code ?? "",
      name: data?.name ?? "",
      producer: data?.producer ?? "",
      country_of_origin: data?.country_of_origin ?? null,
    },
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: ({ value }) => mutation.mutateAsync(value),
  });

  const mutation = useMutation({
    mutationFn: (value: NewRawMaterial) =>
      data
        ? api.updateRawMaterial(data.id, value)
        : api.createRawMaterial(value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["raw_materials"] });
      toast.success(data ? "Đã cập nhật nguyên liệu" : "Đã tạo nguyên liệu");
      onSaved?.();
      setOpen(false);
      if (!data) form.reset();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : String(e));
    },
  });

  // Mỗi lần mở dialog: reset về giá trị gốc (tạo: rỗng, sửa: theo `data` hiện tại).
  // Nhờ vậy nhập/sửa dở rồi đóng, mở lại sẽ thấy form ban đầu.
  React.useEffect(() => {
    if (open) {
      form.reset({
        code: data?.code ?? "",
        name: data?.name ?? "",
        producer: data?.producer ?? "",
        country_of_origin: data?.country_of_origin ?? null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!isControlled &&
        (trigger ? (
          <DialogTrigger render={trigger as React.ReactElement} />
        ) : (
          <DialogTrigger
            render={
              data ? (
                <Button variant="outline">
                  <PencilIcon />
                  <span className="hidden sm:inline">Cập nhật nguyên liệu</span>
                </Button>
              ) : (
                <Button variant="outline">
                  <PlusIcon />
                  <span className="hidden sm:inline">Thêm nguyên liệu</span>
                </Button>
              )
            }
          />
        ))}
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
          <DialogTitle>
            {data ? "Sửa nguyên liệu" : "Thêm nguyên liệu"}
          </DialogTitle>
          <DialogDescription>
            {data
              ? "Cập nhật thông tin nguyên liệu. Nhấn Cập nhật khi xong."
              : "Nhập thông tin nguyên liệu mới. Nhấn Tạo khi xong."}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <form.Field
            name="code"
            children={(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel htmlFor={field.name}>Mã nguyên liệu</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    aria-invalid={isInvalid}
                    placeholder="ICHRM-xxx"
                    type="text"
                    required
                  />
                  <FieldDescription>
                    Mã nguyên liệu trên google sheet
                  </FieldDescription>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                </Field>
              );
            }}
          />

          <form.Field
            name="name"
            children={(field) => {
              return (
                <Field>
                  <FieldLabel htmlFor={field.name}>Tên nguyên liệu</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Tên nguyên liệu"
                    required
                  />
                </Field>
              );
            }}
          />

          <form.Field
            name="producer"
            children={(field) => {
              return (
                <Field>
                  <FieldLabel htmlFor={field.name}>Tên nhà sản xuất</FieldLabel>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Tên nhà sản xuất"
                    required
                  />
                  <FieldDescription>
                    Tên nhà sản xuất nguyên liệu
                  </FieldDescription>
                </Field>
              );
            }}
          />

          <form.Field
            name="country_of_origin"
            children={(field) => {
              return (
                <Field>
                  <FieldLabel htmlFor={field.name}>Quốc gia</FieldLabel>
                  <Select
                    items={countries}
                    defaultValue={field.state.value}
                    onValueChange={field.handleChange}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent onBlur={field.handleBlur}>
                      <SelectGroup>
                        {countries.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>Quốc gia của nhà sản xuất</FieldDescription>
                </Field>
              );
            }}
          />
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
                {data ? "Cập nhật" : "Tạo"}
              </Button>
            </DialogFooter>
          )}
        />
      </DialogContent>
    </Dialog>
  );
};

export default RawMaterialDialog;
