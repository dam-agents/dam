import { Add, ChevronLeft, ChevronRight, Search } from "@carbon/icons-react";
import type { UserBudgetEntry, UserBudgetsSort } from "api-server-api";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AddRow,
  ListSection,
  SectionHeader,
} from "@/components/ui/list-section";
import { Select } from "@/components/ui/select";

import { useStore } from "../../../store.js";
import { HelpTip } from "../../spend/components/help-tip.js";
import { useRemoveUserBudget } from "../api/mutations.js";
import { useUserBudgets } from "../api/queries.js";
import {
  defaultsLine,
  noMatchLine,
  pageLine,
  removeConfirmLine,
  SET_BUDGET,
  SET_BUDGET_HINT,
  USER_BUDGETS_EMPTY,
  USER_BUDGETS_HELP,
  USER_BUDGETS_LOAD_ERROR,
  USER_BUDGETS_PAGE_SIZE,
  USER_BUDGETS_TITLE,
} from "../lib/user-budget-copy.js";
import { UserBudgetDialog } from "./user-budget-dialog.js";
import { UserBudgetRow } from "./user-budget-row.js";

const SORTS: Record<UserBudgetsSort, string> = {
  changed: "Last changed",
  cpu: "Most CPU",
  memory: "Most memory",
  storage: "Most storage",
};

const SEARCH_DELAY_MS = 300;

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type DialogTarget = { entry: UserBudgetEntry | null } | null;

// UNIT_BOUNDARY_DESCRIPTION: the operator's list of users' own compute budgets. The server finds, sorts and pages them, and the section asks for one page at a time, so it stays fast with thousands of budgets. The total and the install's default sit above the list.
export function UserBudgetsSection() {
  const [typed, setTyped] = useState("");
  const query = useDebounced(typed.trim(), SEARCH_DELAY_MS);
  const [sort, setSort] = useState<UserBudgetsSort>("changed");
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [query, sort]);
  const { data, isLoading, isError, isPlaceholderData } = useUserBudgets({
    ...(query ? { query } : {}),
    sort,
    offset,
    limit: USER_BUDGETS_PAGE_SIZE,
  });
  const removeBudget = useRemoveUserBudget();
  const showConfirm = useStore((s) => s.showConfirm);
  const [dialog, setDialog] = useState<DialogTarget>(null);
  const entries = data?.entries ?? [];
  const removing = removeBudget.isPending ? removeBudget.variables.user : null;
  const removingSub =
    removing && "ownerSub" in removing ? removing.ownerSub : null;
  const total = data?.total ?? 0;
  const matched = data?.matched ?? 0;
  const searching = query !== "";

  useEffect(() => {
    if (data && entries.length === 0 && offset > 0 && !isPlaceholderData) {
      setOffset(Math.max(0, offset - USER_BUDGETS_PAGE_SIZE));
    }
  }, [data, entries.length, offset, isPlaceholderData]);

  async function remove(entry: UserBudgetEntry) {
    if (!data) return;
    const ok = await showConfirm(
      <p>
        <span className="font-semibold text-foreground">
          {entry.email ?? entry.ownerSub}
        </span>{" "}
        {removeConfirmLine(data.defaults)}
      </p>,
      "Remove compute budget?",
      { kind: "destructive", confirmLabel: "Remove budget" },
    );
    if (ok) removeBudget.mutate({ user: { ownerSub: entry.ownerSub } });
  }

  const toolbar = total > 0 && (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          size={16}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          size="sm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Find by email or user id"
          aria-label="Find a compute budget by email or user id"
          className="pl-9"
        />
      </div>
      <div className="w-36">
        <Select
          size="sm"
          aria-label="Sort compute budgets"
          value={sort}
          onChange={(event) => setSort(event.target.value as UserBudgetsSort)}
        >
          {Object.entries(SORTS)
            .filter(([value]) => value !== "storage" || data?.defaults.storage)
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </Select>
      </div>
    </div>
  );

  const pager = matched > USER_BUDGETS_PAGE_SIZE && (
    <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2 text-sm text-muted-foreground">
      <span aria-live="polite">
        {pageLine(offset, entries.length, matched)}
      </span>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Previous page"
        disabled={offset === 0 || isPlaceholderData}
        onClick={() => setOffset(Math.max(0, offset - USER_BUDGETS_PAGE_SIZE))}
      >
        <ChevronLeft size={16} />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Next page"
        disabled={
          offset + USER_BUDGETS_PAGE_SIZE >= matched || isPlaceholderData
        }
        onClick={() => setOffset(offset + USER_BUDGETS_PAGE_SIZE)}
      >
        <ChevronRight size={16} />
      </Button>
    </div>
  );

  return (
    <>
      <SectionHeader
        label={
          <span className="inline-flex items-center gap-1.5">
            {USER_BUDGETS_TITLE}
            {total > 0 && (
              <span className="font-normal text-muted-foreground">{total}</span>
            )}
            <HelpTip content={USER_BUDGETS_HELP} />
          </span>
        }
      />
      {data && (
        <p className="mb-3 text-sm text-muted-foreground">
          {defaultsLine(data.defaults)}
        </p>
      )}
      {toolbar}
      <ListSection
        loading={isLoading}
        error={isError && USER_BUDGETS_LOAD_ERROR}
        isEmpty={entries.length === 0}
        empty={searching ? noMatchLine(query) : USER_BUDGETS_EMPTY}
        onNew={() => setDialog({ entry: null })}
        newLabel={SET_BUDGET}
        footer={pager}
        addRow={
          <AddRow onClick={() => setDialog({ entry: null })}>
            <Add size={20} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-md font-medium text-foreground">
                {SET_BUDGET}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {SET_BUDGET_HINT}
              </p>
            </div>
          </AddRow>
        }
      >
        {data &&
          entries.map((entry) => (
            <UserBudgetRow
              key={entry.ownerSub}
              entry={entry}
              defaults={data.defaults}
              onChange={(target) => setDialog({ entry: target })}
              onRemove={(target) => void remove(target)}
              removing={removingSub === entry.ownerSub}
            />
          ))}
      </ListSection>

      {dialog && data && (
        <UserBudgetDialog
          entry={dialog.entry}
          defaults={data.defaults}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
