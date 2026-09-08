import * as XLSX from "xlsx";

export const REGISTER_FIELDS = [
  "id",
  "name",
  "category",
  "district",
  "state",
  "location",
  "sanctionAmount",
  "expenditure",
  "progress",
  "latitude",
  "longitude",
  "description",
  "startDate",
  "expectedCompletion",
] as const;

export type RegisterField = (typeof REGISTER_FIELDS)[number];

export type RegisterRowError = {
  row: number | "header";
  errors: string[];
};

export type RegisterHeaderMapping = {
  source: string;
  target: RegisterField | null;
};

export type RegisterParseResult = {
  records: Array<Record<string, unknown>>;
  rowNumbers: number[];
  headerMappings: RegisterHeaderMapping[];
  errors: RegisterRowError[];
};

const requiredFields: RegisterField[] = [
  "id",
  "name",
  "category",
  "district",
  "state",
  "sanctionAmount",
  "expenditure",
  "progress",
  "latitude",
  "longitude",
  "description",
];

const headerAliases: Record<string, RegisterField> = {
  id: "id",
  projectid: "id",
  projectcode: "id",
  name: "name",
  projectname: "name",
  category: "category",
  district: "district",
  state: "state",
  location: "location",
  sanctionamount: "sanctionAmount",
  sanctionedamount: "sanctionAmount",
  expenditure: "expenditure",
  spent: "expenditure",
  progress: "progress",
  progresspercent: "progress",
  latitude: "latitude",
  lat: "latitude",
  longitude: "longitude",
  lng: "longitude",
  lon: "longitude",
  description: "description",
  details: "description",
  startdate: "startDate",
  expectedcompletion: "expectedCompletion",
  expectedcompletiondate: "expectedCompletion",
  completiondate: "expectedCompletion",
};

const normalizeHeader = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const displayField = (field: RegisterField) =>
  field.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());

const textValue = (value: unknown) => String(value ?? "").trim();

function parseNumber(value: unknown, field: RegisterField): number | string {
  const raw = textValue(value);
  if (!raw) return `${displayField(field)} is required`;
  const percent = raw.endsWith("%");
  const normalized = raw.replace(/[,₹$€£\s]/g, "").replace(/%$/, "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return `${displayField(field)} must be a number`;
  if (percent && field !== "progress") return `${displayField(field)} must be a number`;
  return parsed;
}

function readRows(file: File): Promise<unknown[][]> {
  return file.arrayBuffer().then((data) => {
    const workbook = XLSX.read(data, { type: "array", cellDates: false, raw: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) return [];
    return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
      header: 1,
      defval: "",
      raw: false,
    });
  });
}

function parseRows(rows: unknown[][]): RegisterParseResult {
  if (!rows.length) {
    return {
      records: [],
      rowNumbers: [],
      headerMappings: [],
      errors: [{ row: "header", errors: ["The file is empty"] }],
    };
  }

  const headers = rows[0].map((header) => textValue(header));
  const headerMappings: RegisterHeaderMapping[] = headers.map((source) => ({
    source,
    target: headerAliases[normalizeHeader(source)] ?? null,
  }));
  const errors: RegisterRowError[] = [];

  if (headers.every((header) => !header)) {
    errors.push({ row: "header", errors: ["The first row must contain column headers"] });
    return { records: [], rowNumbers: [], headerMappings, errors };
  }

  const mappedFields = headerMappings.flatMap((mapping) => (mapping.target ? [mapping.target] : []));
  const duplicateFields = [...new Set(mappedFields.filter((field, index) => mappedFields.indexOf(field) !== index))];
  const headerErrors = [
    ...headerMappings
      .filter((mapping) => !mapping.target)
      .map((mapping) => mapping.source ? `Unrecognised column "${mapping.source}"` : "A column header is blank"),
    ...duplicateFields.map((field) => `Column "${displayField(field)}" is mapped more than once`),
    ...requiredFields
      .filter((field) => !mappedFields.includes(field))
      .map((field) => `Missing required column "${displayField(field)}"`),
  ];
  if (headerErrors.length) errors.push({ row: "header", errors: headerErrors });

  const records: Array<Record<string, unknown>> = [];
  const rowNumbers: number[] = [];
  rows.slice(1).forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const rowErrors: string[] = [];
    const values = Object.fromEntries(
      headerMappings.flatMap((mapping, index) =>
        mapping.target ? [[mapping.target, row[index]]] : [],
      ),
    ) as Partial<Record<RegisterField, unknown>>;

    if (row.every((value) => !textValue(value))) {
      rowErrors.push("The row is blank");
    }

    for (const field of requiredFields) {
      if (!textValue(values[field])) rowErrors.push(`${displayField(field)} is required`);
    }

    const numericFields: RegisterField[] = [
      "sanctionAmount",
      "expenditure",
      "progress",
      "latitude",
      "longitude",
    ];
    const numericValues: Partial<Record<RegisterField, number>> = {};
    for (const field of numericFields) {
      const parsed = parseNumber(values[field], field);
      if (typeof parsed === "string") {
        if (textValue(values[field])) rowErrors.push(parsed);
      } else {
        numericValues[field] = parsed;
      }
    }

    if (rowErrors.length) {
      errors.push({ row: rowNumber, errors: [...new Set(rowErrors)] });
      return;
    }

    records.push({
      id: textValue(values.id),
      name: textValue(values.name),
      category: textValue(values.category),
      district: textValue(values.district),
      state: textValue(values.state),
      ...(textValue(values.location) ? { location: textValue(values.location) } : {}),
      sanctionAmount: numericValues.sanctionAmount!,
      expenditure: numericValues.expenditure!,
      progress: numericValues.progress!,
      latitude: numericValues.latitude!,
      longitude: numericValues.longitude!,
      description: textValue(values.description),
      ...(textValue(values.startDate) ? { startDate: textValue(values.startDate) } : {}),
      ...(textValue(values.expectedCompletion)
        ? { expectedCompletion: textValue(values.expectedCompletion) }
        : {}),
    });
    rowNumbers.push(rowNumber);
  });

  return { records, rowNumbers, headerMappings, errors };
}

export async function parseRegisterFile(file: File): Promise<RegisterParseResult> {
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "xlsx") {
    return {
      records: [],
      rowNumbers: [],
      headerMappings: [],
      errors: [{ row: "header", errors: ["Choose a CSV or XLSX register file"] }],
    };
  }

  try {
    return parseRows(await readRows(file));
  } catch {
    return {
      records: [],
      rowNumbers: [],
      headerMappings: [],
      errors: [{ row: "header", errors: ["The file could not be read. Check that it is a valid CSV or XLSX file"] }],
    };
  }
}