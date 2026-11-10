
function parseCSV(text) {
    const rows = [];
    let row = [], value = "", quoted = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') {
            if (quoted && text[i + 1] === '"') { value += '"'; i++; }
            else quoted = !quoted;
        } else if (ch === "," && !quoted) {
            row.push(value); value = "";
        } else if ((ch === "\n" || ch === "\r") && !quoted) {
            if (ch === "\r" && text[i + 1] === "\n") i++;
            row.push(value);
            if (row.some(v => v.trim() !== "")) rows.push(row);
            row = []; value = "";
        } else value += ch;
    }
    row.push(value);
    if (row.some(v => v.trim() !== "")) rows.push(row);
    if (rows.length < 2) throw new Error("Each CSV must contain a header and at least one data row.");

    const headers = rows[0].map(h => h.trim());
    return rows.slice(1).map(values => {
        const record = {};
        headers.forEach((h, i) => record[h] = (values[i] ?? "").trim());
        return record;
    });
}

function properCase(value) {
    return String(value ?? "").trim().toLowerCase()
        .replace(/\b[a-z]/g, letter => letter.toUpperCase());
}

async function readCSV(inputId, label) {
    const file = document.getElementById(inputId).files[0];
    if (!file) throw new Error("Please select the " + label + " CSV file.");
    return parseCSV(await file.text());
}

async function runETL() {
    const button = document.getElementById("runButton");
    const status = document.getElementById("status");
    button.disabled = true;
    status.textContent = "Reading files and running ETL...";

    try {
        const [sis, lms, accounting] = await Promise.all([
            readCSV("sisFile", "SIS"),
            readCSV("lmsFile", "LMS"),
            readCSV("accountingFile", "Accounting")
        ]);

        const programMap = {
            BSIT: "Bachelor of Science in Information Technology",
            BSCS: "Bachelor of Science in Computer Science",
            BSIS: "Bachelor of Science in Information Systems"
        };

        const lmsById = new Map();
        const accountingById = new Map();
        const sisIds = new Set(sis.map(r => String(r.student_id ?? "").trim()));

        lms.forEach(r => {
            const id = String(r.student_id ?? "").trim();
            if (!lmsById.has(id)) lmsById.set(id, r);
        });
        accounting.forEach(r => {
            const id = String(r.student_id ?? "").trim();
            if (!accountingById.has(id)) accountingById.set(id, r);
        });

        const integratedStudents = sis.map((student, index) => {
            const idText = String(student.student_id ?? "").trim();
            const studentId = Number.parseInt(idText, 10);
            const programCode = String(student.program_code ?? "").trim().toUpperCase();

            if (!Number.isInteger(studentId))
                throw new Error("Invalid student_id in SIS row " + (index + 2) + ".");
            if (!programMap[programCode])
                throw new Error("Unknown program code '" + programCode + "' in SIS row " + (index + 2) + ".");

            const lmsRecord = lmsById.get(idText);
            const accountingRecord = accountingById.get(idText);

            let finalGrade = null;
            if (lmsRecord && String(lmsRecord.final_grade ?? "").trim() !== "") {
                const rawGrade = String(lmsRecord.final_grade).trim();
                finalGrade = Number.isFinite(Number(rawGrade)) ? Number(rawGrade) : rawGrade.toUpperCase();
            }

            let outstandingBalance = null;
            if (accountingRecord && String(accountingRecord.account_balance ?? "").trim() !== "") {
                outstandingBalance = Number(String(accountingRecord.account_balance).trim());
                if (!Number.isFinite(outstandingBalance))
                    throw new Error("Invalid account balance for student " + idText + ".");
            }

            return {
                studentId,
                studentName: properCase(student.student_name),
                program: programMap[programCode],
                emailAddress: String(student.email ?? "").trim().toLowerCase(),
                lms: lmsRecord ? {
                    courseCode: String(lmsRecord.course_code ?? "").trim().toUpperCase(),
                    finalGrade,
                    completionStatus: properCase(lmsRecord.completion_status)
                } : null,
                accounting: accountingRecord ? {
                    outstandingBalance,
                    currency: String(accountingRecord.currency ?? "").trim().toUpperCase()
                } : null
            };
        });

        const unmatchedRecords = [];
        lms.forEach(record => {
            if (!sisIds.has(String(record.student_id ?? "").trim()))
                unmatchedRecords.push({ sourceSystem: "LMS", ...record });
        });
        accounting.forEach(record => {
            if (!sisIds.has(String(record.student_id ?? "").trim()))
                unmatchedRecords.push({ sourceSystem: "Accounting", ...record });
        });

        const result = integratedStudents;
        document.getElementById("jsonOutput").textContent = JSON.stringify(result, null, 4);
        status.textContent = "ETL completed successfully.";
    } catch (error) {
        status.textContent = error.message;
        status.style.color = "#b91c1c";
    } finally {
        button.disabled = false;
    }
}
