import React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronsUpDownIcon, SearchIcon } from "lucide-react";

import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "./ui/input-group";
import { Spinner } from "./ui/spinner";
import { api, type RawMaterial } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { cn } from "@/lib/utils";

/** Số nguyên liệu nạp mỗi lần tìm — nhiều hơn thì gõ thêm cho hẹp lại. */
const PICKER_LIMIT = 20;

export type RawMaterialPickerProps = {
  value: RawMaterial | null;
  onChange: (m: RawMaterial) => void;
  placeholder?: string;
  /** Bôi đỏ như ô nhập thiếu — dùng cho ô bắt buộc, không dùng cho ô "điền nhanh". */
  invalid?: boolean;
  className?: string;
};

/**
 * 2 dòng mô tả 1 nguyên liệu, dùng chung cho nút và danh sách để hai chỗ không lệch nhau:
 * tên là chính, nhà sản xuất · quốc gia ở dòng dưới, mã in nhỏ mờ ở cuối (mã là khoá duy nhất và
 * là cột trong CSV tải COA nên vẫn giữ, chỉ hạ vai trò).
 */
function MaterialLines({ m }: { m: RawMaterial }) {
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium">{m.name}</span>
      <span className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
        <span className="truncate">
          {/* Quốc gia có thể trống -> không để dấu · cụt lủn. */}
          {[m.producer, m.country_of_origin].filter(Boolean).join(" · ")}
        </span>
        <span className="ml-auto shrink-0">{m.code}</span>
      </span>
    </span>
  );
}

/**
 * Ô chọn 1 nguyên liệu có tìm kiếm. Dự án chưa có combobox nên ghép từ Popover + ô tìm:
 * gõ tức thì, debounce 500ms rồi mới hỏi `list_raw_materials` (server khớp code/name/producer)
 * — danh mục lớn cỡ nào cũng chỉ kéo về `PICKER_LIMIT` dòng.
 */
const RawMaterialPicker = ({
  value,
  onChange,
  placeholder = "Chọn nguyên liệu",
  invalid = false,
  className,
}: RawMaterialPickerProps) => {
  const [open, setOpen] = React.useState(false);
  const [qInput, setQInput] = React.useState("");
  const q = useDebounce(qInput, 500);

  const list = useQuery({
    queryKey: ["raw_materials", "picker", q.trim()],
    queryFn: () =>
      api.listRawMaterials({ q: q.trim() || undefined, pageSize: PICKER_LIMIT }),
    // Chỉ hỏi khi popover đang mở -> đóng lại thì không tốn truy vấn nào.
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const items = list.data?.data ?? [];
  const total = list.data?.total ?? 0;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQInput("");
      }}
    >
      <PopoverTrigger
        render={
          // Button mặc định cao cố định + nowrap -> phải mở khoá mới xuống được 2 dòng.
          <Button
            variant="outline"
            aria-invalid={invalid}
            className={cn(
              "h-auto w-full justify-between gap-2 py-1.5 text-left font-normal whitespace-normal",
              className,
            )}
          >
            {value ? (
              <MaterialLines m={value} />
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDownIcon className="shrink-0 opacity-50" />
          </Button>
        }
      />
      <PopoverContent align="start" className="w-(--anchor-width) min-w-96 p-2">
        <InputGroup>
          <InputGroupInput
            autoFocus
            placeholder="Tìm theo tên, nhà sản xuất hoặc mã..."
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <InputGroupAddon align="inline-end">
            {list.isFetching ? <Spinner /> : <SearchIcon />}
          </InputGroupAddon>
        </InputGroup>

        <div className="mt-2 max-h-64 overflow-auto">
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {list.isPending ? "Đang tải..." : "Không tìm thấy nguyên liệu"}
            </p>
          ) : (
            items.map((m) => (
              <button
                key={m.id}
                type="button"
                className={cn(
                  "block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent",
                  m.id === value?.id && "bg-accent",
                )}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <MaterialLines m={m} />
              </button>
            ))
          )}
        </div>

        {/* Nói rõ đang cắt bớt, đừng để người dùng tưởng danh sách chỉ có bấy nhiêu. */}
        {total > items.length && (
          <p className="mt-1 px-2 text-xs text-muted-foreground">
            Hiện {items.length}/{total} — gõ thêm để thu hẹp.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
};

export default RawMaterialPicker;
