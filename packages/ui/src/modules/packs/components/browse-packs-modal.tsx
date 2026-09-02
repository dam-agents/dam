import { Search } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { CARD_HOVER, CARD_SURFACE } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import {
  type Pack,
  PACK_CATEGORIES,
  type PackCategory,
  PACKS,
} from "../data/packs.js";
import { PackIngredientSummary } from "./pack-ingredient-summary.js";

type CategoryFilter = "All" | PackCategory;

const CATEGORY_TABS: readonly TabDef<CategoryFilter>[] = [
  { value: "All", label: "All" },
  ...PACK_CATEGORIES.map((c) => ({ value: c as CategoryFilter, label: c })),
];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (pack: Pack) => void;
}

export function BrowsePacksModal({ open, onClose, onSelect }: Props) {
  const [category, setCategory] = useState<CategoryFilter>("All");
  const [search, setSearch] = useState("");
  const isSearching = search.trim().length > 0;

  const filtered = useMemo(() => {
    let result = PACKS as Pack[];
    if (!isSearching && category !== "All") {
      result = result.filter((p) => p.category === category);
    }
    if (isSearching) {
      const q = search.toLowerCase();
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.tagline.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      );
    }
    return result;
  }, [category, search, isSearching]);

  if (!open) return null;

  return (
    <Modal widthClass="w-[960px]">
      <DialogHeader onClose={onClose} divided>
        <h2 className="text-lg font-semibold text-foreground">
          Browse presets
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Pick a preset to pre-fill your agent setup
        </p>
      </DialogHeader>

      <div className="px-6 pt-4">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Search presets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9"
          />
        </div>
        {!isSearching && (
          <Tabs
            tabs={CATEGORY_TABS}
            value={category}
            onValueChange={setCategory}
            variant="pill"
            size="sm"
            ariaLabel="Filter presets by category"
            className="mt-3"
          />
        )}
      </div>

      <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No presets match your search
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((pack) => {
              const PackIcon = pack.icon;
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => {
                    onSelect(pack);
                    onClose();
                  }}
                  className={cn(
                    CARD_SURFACE,
                    CARD_HOVER,
                    "flex flex-col overflow-hidden text-left",
                  )}
                >
                  <div className="flex h-28 w-full items-center justify-center bg-preset-light">
                    <PackIcon size={16} className="text-preset/40" />
                  </div>
                  <div className="flex flex-1 flex-col p-4">
                    <h4 className="text-sm font-semibold text-foreground">
                      {pack.name}
                    </h4>
                    <p className="mt-1 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {pack.tagline}
                    </p>
                    <div className="mt-3">
                      <PackIngredientSummary pack={pack} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
