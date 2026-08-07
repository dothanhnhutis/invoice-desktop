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

const VIET_NAM = "Việt Nam";

/**
 * Tên quốc gia/vùng lãnh thổ bằng tiếng Việt. Thứ tự khai báo ở đây KHÔNG quan trọng —
 * `countries` bên dưới tự sắp A-Z theo collation tiếng Việt, nên thêm tên mới vào bất kỳ nhóm nào.
 */
const COUNTRY_NAMES = [
  // Châu Á
  "Afghanistan", "Ả Rập Xê Út", "Armenia", "Azerbaijan", "Ấn Độ", "Bahrain",
  "Bangladesh", "Bhutan", "Brunei", "Các Tiểu vương quốc Ả Rập Thống nhất",
  "Campuchia", "Đài Loan", "Gruzia", "Hàn Quốc", "Hồng Kông", "Indonesia",
  "Iran", "Iraq", "Israel", "Jordan", "Kazakhstan", "Kuwait", "Kyrgyzstan",
  "Lào", "Liban", "Ma Cao", "Malaysia", "Maldives", "Mông Cổ", "Myanmar",
  "Nepal", "Nhật Bản", "Oman", "Pakistan", "Palestine", "Philippines", "Qatar",
  "Singapore", "Síp", "Sri Lanka", "Syria", "Tajikistan", "Thái Lan",
  "Thổ Nhĩ Kỳ", "Timor-Leste", "Triều Tiên", "Trung Quốc", "Turkmenistan",
  "Uzbekistan", VIET_NAM, "Yemen",

  // Châu Âu
  "Albania", "Andorra", "Anh", "Áo", "Ba Lan", "Bắc Macedonia", "Belarus", "Bỉ",
  "Bosnia và Herzegovina", "Bồ Đào Nha", "Bulgaria", "Cộng hòa Séc", "Croatia",
  "Đan Mạch", "Đức", "Estonia", "Hà Lan", "Hungary", "Hy Lạp", "Iceland",
  "Ireland", "Kosovo", "Latvia", "Liechtenstein", "Litva", "Luxembourg",
  "Malta", "Moldova", "Monaco", "Montenegro", "Na Uy", "Nga", "Pháp",
  "Phần Lan", "Romania", "San Marino", "Serbia", "Slovakia", "Slovenia",
  "Tây Ban Nha", "Thụy Điển", "Thụy Sĩ", "Ukraina", "Vatican", "Ý",

  // Châu Mỹ
  "Antigua và Barbuda", "Argentina", "Bahamas", "Barbados", "Belize", "Bolivia",
  "Brazil", "Canada", "Chile", "Colombia", "Costa Rica", "Cộng hòa Dominica",
  "Cuba", "Dominica", "Ecuador", "El Salvador", "Grenada", "Guatemala",
  "Guyana", "Haiti", "Honduras", "Jamaica", "Mexico", "Mỹ", "Nicaragua",
  "Panama", "Paraguay", "Peru", "Saint Kitts và Nevis", "Saint Lucia",
  "Saint Vincent và Grenadines", "Suriname", "Trinidad và Tobago", "Uruguay",
  "Venezuela",

  // Châu Phi
  "Ai Cập", "Algeria", "Angola", "Benin", "Bờ Biển Ngà", "Botswana",
  "Burkina Faso", "Burundi", "Cameroon", "Cape Verde", "Chad", "Comoros",
  "Cộng hòa Congo", "Cộng hòa Dân chủ Congo", "Cộng hòa Trung Phi", "Djibouti",
  "Eritrea", "Eswatini", "Ethiopia", "Gabon", "Gambia", "Ghana", "Guinea",
  "Guinea Xích Đạo", "Guinea-Bissau", "Kenya", "Lesotho", "Liberia", "Libya",
  "Madagascar", "Malawi", "Mali", "Maroc", "Mauritania", "Mauritius",
  "Mozambique", "Nam Phi", "Nam Sudan", "Namibia", "Niger", "Nigeria", "Rwanda",
  "São Tomé và Príncipe", "Senegal", "Seychelles", "Sierra Leone", "Somalia",
  "Sudan", "Tanzania", "Togo", "Tunisia", "Uganda", "Zambia", "Zimbabwe",

  // Châu Đại Dương
  "Fiji", "Kiribati", "Micronesia", "Nauru", "New Zealand", "Palau",
  "Papua New Guinea", "Quần đảo Marshall", "Quần đảo Solomon", "Samoa", "Tonga",
  "Tuvalu", "Úc", "Vanuatu",
];

// Việt Nam luôn trên cùng; phần còn lại A-Z theo tiếng Việt (Đ sau D, Ă/Â sau A…).
const countries: { label: string; value: string | null }[] = [
  { label: "Chọn quốc gia", value: null },
  { label: VIET_NAM, value: VIET_NAM },
  ...COUNTRY_NAMES.filter((n) => n !== VIET_NAM)
    .sort(new Intl.Collator("vi").compare)
    .map((n) => ({ label: n, value: n })),
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

  // Bản ghi cũ có thể mang tên không còn trong danh sách (vd "Brazin", "Tây Bán Nha",
  // "Thuỵ Sỹ") -> chèn thêm để Select không hiện trống khi sửa.
  const options = React.useMemo(() => {
    const current = data?.country_of_origin;
    return current && !countries.some((c) => c.value === current)
      ? [...countries, { label: current, value: current }]
      : countries;
  }, [data?.country_of_origin]);

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
                    items={options}
                    defaultValue={field.state.value}
                    onValueChange={field.handleChange}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent onBlur={field.handleBlur}>
                      <SelectGroup>
                        {options.map((item) => (
                          <SelectItem key={item.value ?? "none"} value={item.value}>
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
