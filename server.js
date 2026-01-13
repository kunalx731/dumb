require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const ExcelJS = require('exceljs');
const { jsPDF } = require("jspdf");
const autoTable = require("jspdf-autotable").default;
const db = require('./db'); 

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(bodyParser.json());

/* ---------------- CONFIG & HELPERS ---------------- */
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "nhai@2026";

// Terminology Mapper for Section 11
const getFeedbackLabel = (val) => {
  const mapping = {
    "1": "Non Effective",
    "2": "Least Effective",
    "3": "Slightly Effective",
    "4": "Very Effective",
    "5": "Extremely Effective"
  };
  return mapping[val] || "N/A";
};

// Helper for safe JSON parsing
const safeParse = (data) => {
    if (!data) return {};
    if (typeof data === 'object') return data;
    try {
        return JSON.parse(data);
    } catch (e) {
        return {};
    }
};

/* ---------------- 1. ADMIN ENDPOINTS ---------------- */

app.post("/api/admin/login", (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.status(200).json({ success: true, message: "Login successful" });
  } else {
    res.status(401).json({ success: false, message: "Invalid credentials" });
  }
});

app.get("/api/admin/submissions", async (req, res) => {
  try {
    const query = `SELECT id, meta_ro_name, meta_piu_name, meta_project_name, submission_timestamp 
                    FROM project_submissions ORDER BY submission_timestamp DESC`;
    const result = await db.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Fetch Error:", err);
    res.status(500).json({ error: "Failed to fetch submissions" });
  }
});

/* ---------------- 2. SUBMISSION ENDPOINT ---------------- */

app.post("/api/submit", async (req, res) => {
  try {
    const { metadata, sec00, sec01, sec02, sec03, sec04, sec05, sec06, sec07, sec08, sec09, sec10, sec11, sec12 } = req.body;
    
    const query = `INSERT INTO project_submissions (
        meta_ro_name, meta_ro_code, meta_piu_name, meta_project_name, submission_timestamp, 
        sec00, sec01, sec02, sec03, sec04, sec05, sec06, sec07, sec08, sec09, sec10, sec11, sec12
    ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) RETURNING id`;

    const values = [
        metadata.ro_name, metadata.ro_code, metadata.piu, metadata.project,
        JSON.stringify(sec00), JSON.stringify(sec01), JSON.stringify(sec02), JSON.stringify(sec03),
        JSON.stringify(sec04), JSON.stringify(sec05), JSON.stringify(sec06), JSON.stringify(sec07),
        JSON.stringify(sec08), JSON.stringify(sec09), JSON.stringify(sec10), JSON.stringify(sec11),
        JSON.stringify(sec12 || {})
    ];

    const result = await db.query(query, values);
    res.status(201).json({ status: "success", id: result.rows[0].id });
  } catch (err) {
    console.error("❌ Submission Error:", err);
    res.status(500).json({ status: "error", message: "Internal Server Error" });
  }
});

/* ---------------- 3. CONSOLIDATED EXCEL (TRANSPOSED) - REWRITTEN ---------------- */

app.get("/api/admin/export-consolidated", async (req, res) => {
    try {
        const { rows } = await db.query("SELECT * FROM project_submissions ORDER BY id ASC");
        
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet("Consolidated Master");

        // 1. Pre-process data and determine dynamic column lengths
        const maxCounts = { dep: 0, rep: 0, drw: 0, cos: 0, eot: 0, bll: 0 };
        const data = rows.map(r => {
            const parsed = {
                ...r,
                s00: safeParse(r.sec00), s01: safeParse(r.sec01), s02: safeParse(r.sec02),
                s03: safeParse(r.sec03), s04: safeParse(r.sec04), s05: safeParse(r.sec05),
                s06: safeParse(r.sec06), s07: safeParse(r.sec07), s08: safeParse(r.sec08),
                s09: safeParse(r.sec09), s10: safeParse(r.sec10), s11: safeParse(r.sec11),
                s12: safeParse(r.sec12)
            };
            maxCounts.dep = Math.max(maxCounts.dep, (parsed.s01.deployments || []).length);
            maxCounts.rep = Math.max(maxCounts.rep, (parsed.s02.replacements || []).length);
            maxCounts.drw = Math.max(maxCounts.drw, (parsed.s03.drawings || []).length);
            maxCounts.cos = Math.max(maxCounts.cos, (parsed.s05.cos_items || []).length);
            maxCounts.eot = Math.max(maxCounts.eot, (parsed.s06.eot_items || []).length);
            maxCounts.bll = Math.max(maxCounts.bll, (parsed.s07.bills || []).length);
            return parsed;
        });

        // 2. Build Headers
        const headers = ["ID", "Regional Office", "RO Code", "PIU", "Project Name", "Submission Time"];
        
        // Section 00 & 01 Basics
        headers.push("Awarded Cost (EPC)", "Awarded BPC (HAM)", "Proj Length", "Greenfield", "Brownfield", "Complex Struct?", "Project Type", "Section 1 Remarks");
        
        // Dynamic Section 01: Deployments
        for (let i = 1; i <= maxCounts.dep; i++) {
            headers.push(`KP${i} Desig`, `KP${i} Qty`, `KP${i} Start`, `KP${i} End`, `KP${i} Actual`, `KP${i} Rem`);
        }

        // Section 02 Basics
        headers.push("AE Sign Date", "AE End Date");
        for (let i = 1; i <= maxCounts.rep; i++) {
            headers.push(`Rep${i} Desig`, `Rep${i} Qty`, `Rep${i} CV Sub`, `Rep${i} Mobi`, `Rep${i} Demobi`, `Rep${i} Rem`);
        }

        // Dynamic Section 03: Drawings
        for (let i = 1; i <= maxCounts.drw; i++) {
            headers.push(`Drw${i} Name`, `Drw${i} Sub`, `Drw${i} Ret`, `Drw${i} Appr`, `Drw${i} Rem`);
        }

        // Section 04 Basics
        headers.push("Sched Date", "Phys Progress %", "Likely Date", "DRB Auth", "DRB Conc", "DRB Neut", "COS Count");

        // Dynamic Section 05: COS Items
        for (let i = 1; i <= maxCounts.cos; i++) {
            headers.push(`COS${i} Item`, `COS${i} Sub`, `COS${i} Ret`, `COS${i} Appr`, `COS${i} Rem`);
        }

        headers.push("EOT Count");
        // Dynamic Section 06: EOT Items
        for (let i = 1; i <= maxCounts.eot; i++) {
            headers.push(`EOT${i} Item`, `EOT${i} Sub`, `EOT${i} Ret`, `EOT${i} Appr`, `EOT${i} Rem`);
        }

        headers.push("Avg Process Category");
        // Dynamic Section 07: Bills
        for (let i = 1; i <= maxCounts.bll; i++) {
            headers.push(`Bill${i} No`, `Bill${i} Sub`, `Bill${i} Appr`, `Bill${i} Rem`);
        }

        // Static Sections 08 - 12
        headers.push("PCI Completion", "PCI 2yr Post", "Accidents (3yr)", "Blackspots (3yr)", "Safety Adherence", "NCR Raised", "NCR Closed");
        headers.push("NHAI Manpower", "NHAI Site", "NHAI Tech", "NHAI Quality", "NHAI Bottlenecks");
        headers.push("Contr Manpower", "Contr Bottlenecks", "Contr Site", "Contr Tech", "Contr Quality");
        headers.push("Debarments", "Penalties", "Suspensions");

        const headerRow = worksheet.addRow(headers);

        // Styling the header
        headerRow.eachCell((cell) => {
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        // 3. Populate Rows
        data.forEach(d => {
            const rowValues = [d.id, d.meta_ro_name, d.meta_ro_code, d.meta_piu_name, d.meta_project_name, d.submission_timestamp];
            
            // Sec 00 & 01
            rowValues.push(d.s00.epc_cost_cr, d.s00.ham_bpc_cr, d.s00.project_length_km, d.s00.greenfield_length_km, d.s00.brownfield_length_km, d.s00.has_complex_structure, d.s01.project_type, d.s01.remarks);
            
            // Dynamic Sec 01
            for (let i = 0; i < maxCounts.dep; i++) {
                const item = (d.s01.deployments || [])[i] || {};
                rowValues.push(item.designation, item.qty_val, item.deployment_as_per_contract, item.end_date_as_per_contract_or_eot, item.actual_deployment_date, item.remarks);
            }

            // Sec 02
            rowValues.push(d.s02.agreement_sign_date, d.s02.agreement_end_date);
            for (let i = 0; i < maxCounts.rep; i++) {
                const item = (d.s02.replacements || [])[i] || {};
                rowValues.push(item.designation, item.replacement_qty, item.cv_submission_date, item.mobilization_date, item.demobilization_date, item.remarks);
            }

            // Sec 03
            for (let i = 0; i < maxCounts.drw; i++) {
                const item = (d.s03.drawings || [])[i] || {};
                rowValues.push(item.name, item.submission_date, item.return_date, item.approval_date, item.remarks);
            }

            // Sec 04 & 05
            rowValues.push(d.s04.scheduled_completion_date, d.s04.physical_progress_percent, d.s04.likely_completion_date, d.s04.drb_awards?.authority, d.s04.drb_awards?.concessionaire, d.s04.drb_awards?.neutral, d.s05.cos_count);
            for (let i = 0; i < maxCounts.cos; i++) {
                const item = (d.s05.cos_items || [])[i] || {};
                rowValues.push(item.item_name, item.submission_date, item.return_date, item.approval_date, item.remarks);
            }

            // Sec 06
            rowValues.push(d.s06.eot_count);
            for (let i = 0; i < maxCounts.eot; i++) {
                const item = (d.s06.eot_items || [])[i] || {};
                rowValues.push(item.item_name, item.submission_date, item.return_date, item.approval_date, item.remarks);
            }

            // Sec 07
            rowValues.push(d.s07.avg_processing_time_category);
            for (let i = 0; i < maxCounts.bll; i++) {
                const item = (d.s07.bills || [])[i] || {};
                rowValues.push(item.bill_number, item.last_submission_date, item.approval_date, item.remarks);
            }

            // Sec 08 - 10
            rowValues.push(d.s08.pci_at_completion, d.s08.pci_two_years_post, d.s09.accidents_within_3_years, d.s09.blackspots_within_3_years, d.s09.safety_adherence, d.s10.ncr_raised, d.s10.ncr_closed);

            // Sec 11 NHAI
            rowValues.push(
                getFeedbackLabel(d.s11.nhai?.effectiveness_of_deployed_manpower),
                getFeedbackLabel(d.s11.nhai?.knowledge_of_site_conditions),
                getFeedbackLabel(d.s11.nhai?.knowledge_of_technical_features),
                getFeedbackLabel(d.s11.nhai?.quality_improvement_efforts),
                getFeedbackLabel(d.s11.nhai?.bottleneck_resolution_efforts)
            );

            // Sec 11 Contractor
            rowValues.push(
                getFeedbackLabel(d.s11.contractor?.effectiveness_of_deployed_manpower),
                getFeedbackLabel(d.s11.contractor?.bottleneck_resolution_efforts),
                getFeedbackLabel(d.s11.contractor?.knowledge_of_site_conditions),
                getFeedbackLabel(d.s11.contractor?.knowledge_of_technical_features),
                getFeedbackLabel(d.s11.contractor?.quality_improvement_efforts)
            );

            // Sec 12
            rowValues.push(d.s12.debar, d.s12.penal, d.s12.susp);

            worksheet.addRow(rowValues);
        });

        // Auto-fit columns (approximate)
        worksheet.columns.forEach(col => { col.width = 20; });

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", "attachment; filename=Consolidated_AEIE_Master.xlsx");
        
        await workbook.xlsx.write(res); 
        res.end();

    } catch (err) { 
        console.error("❌ Consolidated Export Error:", err); 
        res.status(500).send("Consolidated Export Failed"); 
    }
});

/* ---------------- 4. INDIVIDUAL EXCEL EXPORT (EXACT HEADERS) ---------------- */

app.get("/api/export/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM project_submissions WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).send("Report not found");
    const d = rows[0];
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Full Report");

    const sH = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } } };
    const cH = { font: { bold: true }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } } };
    const addS = (t) => { ws.addRow([]); const r = ws.addRow([t]); r.eachCell(c => (c.style = sH)); };
    const addH = (c) => { const r = ws.addRow(c); r.eachCell(cl => (cl.style = cH)); };

    // Metadata
    addS("METADATA");
    ws.addRow(["Regional Office", d.meta_ro_name]); ws.addRow(["RO Code", d.meta_ro_code]); ws.addRow(["PIU", d.meta_piu_name]); ws.addRow(["Project Name", d.meta_project_name]); ws.addRow(["Submission Date and Time", d.submission_timestamp]);

    // Section 00
    addS("SECTION 00");
    ws.addRow(["Awarded Cost (excluding GST) in case of EPC project (INR in Cr.)", d.sec00?.epc_cost_cr]);
    ws.addRow(["Awarded BPC in case of HAM Project (INR in Cr.)", d.sec00?.ham_bpc_cr]);
    ws.addRow(["Project Length (Kms)", d.sec00?.project_length_km]);
    ws.addRow(["Greenfield Length of Project (Kms)", d.sec00?.greenfield_length_km]);
    ws.addRow(["Brownfield Length of Project (Kms)", d.sec00?.brownfield_length_km]);
    ws.addRow(["Whether project has tunnel more than 1 Km/extra dozed bridge/ cable stayed bridge/ suspension bridge ?", d.sec00?.has_complex_structure]);

    // Section 01
    addS("SECTION 01");
    ws.addRow(["Project Type", d.sec01?.project_type]);
    addH(["Designation", "No. of KPs", "Date of Deployment as per Contract", "End Date of Deployment as per Contract/EOT", "Actual Date of Deployment", "Remarks"]);
    (d.sec01?.deployments || []).forEach(r => ws.addRow([r.designation, r.qty_val, r.deployment_as_per_contract, r.end_date_as_per_contract_or_eot, r.actual_deployment_date, r.remarks]));
    ws.addRow(["Section 1 Remarks", d.sec01?.remarks]);

    // Section 02
    addS("SECTION 02");
    ws.addRow(["Sign date of Agreement of AE/IE", d.sec02?.agreement_sign_date]); ws.addRow(["End date of Agreement (Original Contract)", d.sec02?.agreement_end_date]);
    addH(["Designation", "No. of Replacements", "Submission of CV", "Mobilization Date", "Demobilization Date", "Remarks"]);
    (d.sec02?.replacements || []).forEach(r => ws.addRow([r.designation, r.replacement_qty, r.cv_submission_date, r.mobilization_date, r.demobilization_date, r.remarks]));

    // Section 03
    addS("SECTION 03");
    addH(["Name of Design / Drawing", "Date of Submission", "Date of Return (Comments)", "Date of Approval", "Remarks"]);
    (d.sec03?.drawings || []).forEach(r => ws.addRow([r.name, r.submission_date, r.return_date, r.approval_date, r.remarks]));

    // Section 04
    addS("SECTION 04");
    ws.addRow(["Scheduled Project Completion date as per CA", d.sec04?.scheduled_completion_date]); ws.addRow(["Physical Progress % of the project till date", d.sec04?.physical_progress_percent]); ws.addRow(["Project Completion Date/Likely Completion Date", d.sec04?.likely_completion_date]); ws.addRow(["No. of DRB/AT Awards in favour of Authority", d.sec04?.drb_awards?.authority]); ws.addRow(["Number of DRB/AT Awards in favour of Concessionaire", d.sec04?.drb_awards?.concessionaire]); ws.addRow(["Number of Neutral DRB/AT Awards", d.sec04?.drb_awards?.neutral]);

    // Section 05
    addS("SECTION 05");
    ws.addRow(["No of COS", d.sec05?.cos_count]);
    addH(["COS for Civil Work / Item Name", "Date of Submission by Contractor", "Date of Return by AE/IE", "Date of Approval by AE/IE", "Remarks"]);
    (d.sec05?.cos_items || []).forEach(r => ws.addRow([r.item_name, r.submission_date, r.return_date, r.approval_date, r.remarks]));

    // Section 06
    addS("SECTION 06");
    ws.addRow(["No of EOT", d.sec06?.eot_count]);
    addH(["EOT for Civil Work / Item Name", "Date of Submission by Contractor", "Date of Return by AE/IE", "Date of Approval by AE/IE", "Remarks"]);
    (d.sec06?.eot_items || []).forEach(r => ws.addRow([r.item_name, r.submission_date, r.return_date, r.approval_date, r.remarks]));

    // Section 07
    addS("SECTION 07");
    ws.addRow(["A. Average time in Processing of Below mentioned proposals", d.sec07?.avg_processing_time_category]);
    addH(["SPC / Milestone Bill No.", "Date of Last Submission", "Date of Approval by AE/IE", "Remarks"]);
    (d.sec07?.bills || []).forEach(r => ws.addRow([r.bill_number, r.last_submission_date, r.approval_date, r.remarks]));

    // Section 08, 09, 10
    addS("SECTION 08");
    ws.addRow(["A. PCI at the time of PCC/COD/Completion", d.sec08?.pci_at_completion]); ws.addRow(["B. PCI two years post COD/Completion", d.sec08?.pci_two_years_post]);
    addS("SECTION 09");
    ws.addRow(["A. No. of accidents occurred on the project stretch within 3 years from Completion (COD)", d.sec09?.accidents_within_3_years]); ws.addRow(["B. No. of blackspots occurred on the project stretch within 3 years from Completion (COD)", d.sec09?.blackspots_within_3_years]); ws.addRow(["C. Adherence to Safety during construction by Contractor/Concessionaire", d.sec09?.safety_adherence]);
    addS("SECTION 10");
    ws.addRow(["1. No. of NCR raised", d.sec10?.ncr_raised]); ws.addRow(["2. No. of NCR closed", d.sec10?.ncr_closed]);

    // Section 11
    addS("SECTION 11");
    addH(["Source", "Performance Criteria", "Rating"]);
    Object.entries(d.sec11?.nhai || {}).forEach(([k, v]) => ws.addRow(["A. NHAI", k.replace(/_/g, ' '), getFeedbackLabel(v)]));
    Object.entries(d.sec11?.contractor || {}).forEach(([k, v]) => ws.addRow(["B. Contractor", k.replace(/_/g, ' '), getFeedbackLabel(v)]));

    // Section 12
    addS("SECTION 12");
    ws.addRow(["1. No. of debarments of firm in last 3 Financial years", d.sec12?.debar]); ws.addRow(["2. No. of times Financial Penalty imposed on Firm in last 3 Financial years", d.sec12?.penal]); ws.addRow(["3. No. of times Key Personnel suspended in last 3 Financial years", d.sec12?.susp]);

    ws.columns.forEach(c => (c.width = 40));
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Report_${d.id}.xlsx`);
    await wb.xlsx.write(res); res.end();
  } catch (err) { console.error(err); res.status(500).send("Excel failed"); }
});

/* ---------------- 5. PDF EXPORT (EXACT MIRROR OF REQUEST) ---------------- */

app.get("/api/export-pdf/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM project_submissions WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).send("Not found");
    const d = rows[0];
    const doc = new jsPDF('p', 'mm', 'a4');

    const addH = (t, y) => {
      doc.setFontSize(10); doc.setTextColor(37, 99, 235); doc.setFont("helvetica", "bold");
      doc.text(t.toUpperCase(), 14, y); doc.setDrawColor(226, 232, 240); doc.line(14, y + 1, 196, y + 1); return y + 8;
    };

    doc.setFontSize(16); doc.setTextColor(15, 23, 42); doc.text("AE/IE PROJECT REPORT", 14, 15);

    // Metadata
    let curY = addH("Metadata", 25);
    autoTable(doc, { startY: curY, body: [['Regional Office', d.meta_ro_name], ['RO Code', d.meta_ro_code], ['PIU', d.meta_piu_name], ['Project Name', d.meta_project_name], ['Submission Date and Time', new Date(d.submission_timestamp).toLocaleString()]], theme: 'grid', styles: { fontSize: 8 } });

    // Section 00
    curY = addH("Section 00", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, body: [
        ["Awarded Cost (excluding GST) in case of EPC project (INR in Cr.)", d.sec00?.epc_cost_cr || "-"],
        ["Awarded BPC in case of HAM Project (INR in Cr.)", d.sec00?.ham_bpc_cr || "-"],
        ["Project Length (Kms)", d.sec00?.project_length_km || "-"],
        ["Greenfield Length of Project (Kms)", d.sec00?.greenfield_length_km || "-"],
        ["Brownfield Length of Project (Kms)", d.sec00?.brownfield_length_km || "-"],
        ["Whether project has tunnel...?", d.sec00?.has_complex_structure || "-"]
    ], theme: 'grid', styles: { fontSize: 8 } });

    // Section 01
    curY = addH("Section 01", doc.lastAutoTable.finalY + 10);
    doc.setFontSize(8); doc.setTextColor(0); doc.text(`Project Type: ${d.sec01?.project_type || ""}`, 14, curY);
    autoTable(doc, { startY: curY + 4, head: [['Designation', 'No. of KPs', 'Deployment Contract', 'End Date Contract', 'Actual Date', 'Remarks']], body: (d.sec01?.deployments || []).map(r => [r.designation, r.qty_val, r.deployment_as_per_contract, r.end_date_as_per_contract_or_eot, r.actual_deployment_date, r.remarks]), theme: 'striped', styles: { fontSize: 6 } });
    doc.text(`Section 1 Remarks: ${d.sec01?.remarks || ""}`, 14, doc.lastAutoTable.finalY + 5);

    // Section 02
    curY = addH("Section 02", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, body: [['Sign date AE/IE', d.sec02?.agreement_sign_date || "-"], ['End date Contract', d.sec02?.agreement_end_date || "-"]], theme: 'grid', styles: { fontSize: 8 } });
    autoTable(doc, { startY: doc.lastAutoTable.finalY + 4, head: [['Designation', 'No. of Replacements', 'Submission of CV', 'Mobilization Date', 'Demobilization Date', 'Remarks']], body: (d.sec02?.replacements || []).map(r => [r.designation, r.replacement_qty, r.cv_submission_date, r.mobilization_date, r.demobilization_date, r.remarks]), theme: 'striped', styles: { fontSize: 6 } });

    // Section 03
    curY = addH("Section 03", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, head: [['Name of Design / Drawing', 'Date of Submission', 'Date of Return', 'Date of Approval', 'Remarks']], body: (d.sec03?.drawings || []).map(r => [r.name, r.submission_date, r.return_date, r.approval_date, r.remarks]), theme: 'grid', styles: { fontSize: 6 } });

    // Section 04
    curY = addH("Section 04", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, body: [['Scheduled Project Completion', d.sec04?.scheduled_completion_date || "-"], ['Physical Progress %', d.sec04?.physical_progress_percent || "-"], ['Likely Completion', d.sec04?.likely_completion_date || "-"], ['No. of DRB Awards (Authority)', d.sec04?.drb_awards?.authority || "0"], ['No. of DRB Awards (Concessionaire)', d.sec04?.drb_awards?.concessionaire || "0"], ['No. of Neutral Awards', d.sec04?.drb_awards?.neutral || "0"]], theme: 'grid', styles: { fontSize: 8 } });

    // Section 05 & 06
    curY = addH("Section 05", doc.lastAutoTable.finalY + 10);
    doc.setFontSize(8); doc.text(`No of COS: ${d.sec05?.cos_count || "0"}`, 14, curY);
    autoTable(doc, { startY: curY + 4, head: [['COS for Civil Work', 'Submission', 'Return', 'Approval', 'Remarks']], body: (d.sec05?.cos_items || []).map(r => [r.item_name, r.submission_date, r.return_date, r.approval_date, r.remarks]), theme: 'striped', styles: { fontSize: 6 } });
    
    curY = addH("Section 06", doc.lastAutoTable.finalY + 10);
    doc.setFontSize(8); doc.text(`No of EOT: ${d.sec06?.eot_count || "0"}`, 14, curY);
    autoTable(doc, { startY: curY + 4, head: [['EOT for Civil Work', 'Submission', 'Return', 'Approval', 'Remarks']], body: (d.sec06?.eot_items || []).map(r => [r.item_name, r.submission_date, r.return_date, r.approval_date, r.remarks]), theme: 'striped', styles: { fontSize: 6 } });

    // Section 07
    curY = addH("Section 07", doc.lastAutoTable.finalY + 10);
    doc.setFontSize(8); doc.text(`A. Avg Processing: ${d.sec07?.avg_processing_time_category || ""}`, 14, curY);
    autoTable(doc, { startY: curY + 4, head: [['SPC Bill No.', 'Date of Last Submission', 'Date of Approval', 'Remarks']], body: (d.sec07?.bills || []).map(r => [r.bill_number, r.last_submission_date, r.approval_date, r.remarks]), theme: 'striped', styles: { fontSize: 6 } });

    // Section 08 - SEPARATED
    curY = addH("Section 08", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, body: [['A. PCI (PCC/COD/Completion)', d.sec08?.pci_at_completion || "-"], ['B. PCI (2yr Post Completion)', d.sec08?.pci_two_years_post || "-"]], theme: 'grid', styles: { fontSize: 8 } });

    // Section 09 - SEPARATED
    curY = addH("Section 09", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, body: [['A. No. of accidents (3yr)', d.sec09?.accidents_within_3_years || "-"], ['B. No. of blackspots (3yr)', d.sec09?.blackspots_within_3_years || "-"], ['C. Adherence to Safety during construction', d.sec09?.safety_adherence || "-"]], theme: 'grid', styles: { fontSize: 8 } });

    // Section 10 - SEPARATED
    curY = addH("Section 10", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, body: [['1. No. of NCR raised', d.sec10?.ncr_raised || "0"], ['2. No. of NCR closed', d.sec10?.ncr_closed || "0"]], theme: 'grid', styles: { fontSize: 8 } });

    // Section 11
    curY = addH("Section 11", doc.lastAutoTable.finalY + 10);
    const fb = [];
    Object.entries(d.sec11?.nhai || {}).forEach(([k, v]) => fb.push(['A. NHAI', k.replace(/_/g, ' '), getFeedbackLabel(v)]));
    Object.entries(d.sec11?.contractor || {}).forEach(([k, v]) => fb.push(['B. Contractor', k.replace(/_/g, ' '), getFeedbackLabel(v)]));
    autoTable(doc, { startY: curY, head: [['Source', 'Performance Criteria', 'Rating']], body: fb, theme: 'grid', styles: { fontSize: 7 } });

    // Section 12
    curY = addH("Section 12", doc.lastAutoTable.finalY + 10);
    autoTable(doc, { startY: curY, body: [['1. No. of debarments (3 Financial yrs)', d.sec12?.debar || 0], ['2. No. of Financial Penalties (3 Financial yrs)', d.sec12?.penal || 0], ['3. No. of Key Personnel suspended (3 Financial yrs)', d.sec12?.susp || 0]], theme: 'grid', styles: { fontSize: 8, fontStyle: 'bold' } });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=Report_${d.id}.pdf`);
    res.send(Buffer.from(doc.output("arraybuffer")));
  } catch (err) { console.error(err); res.status(500).send("PDF failed"); }
});

// Refinement: Start the listener if running locally, and export for Vercel
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
}
