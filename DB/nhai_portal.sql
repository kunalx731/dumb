-- Main table to store form submissions
CREATE TABLE project_submissions (
    id SERIAL PRIMARY KEY,
    
    -- Selection Data
    ro_name VARCHAR(255) NOT NULL,
    piu_name VARCHAR(255) NOT NULL,
    project_name VARCHAR(255) NOT NULL,
    
    -- Section 00: Normalization Data
    epc_cost NUMERIC(15, 2), -- Awarded Cost in Cr.
    ham_cost NUMERIC(15, 2), -- Awarded BPC in Cr.
    project_length_km NUMERIC(10, 2),
    greenfield_length_km NUMERIC(10, 2),
    brownfield_length_km NUMERIC(10, 2),
    has_complex_structure BOOLEAN DEFAULT FALSE,
    
    -- Section 01 & 02: Personnel (Stored as JSONB to handle dynamic rows)
    -- Format: [{"role": "Team Leader", "qty": 1, "contract_start": "2025-01-01", ...}]
    personnel_deployment JSONB,
    personnel_replacements JSONB,
    section_01_remarks TEXT,

    -- Section 03: Design and Drawings
    -- Format: [{"drw_name": "Structure 01", "sub_date": "2025-05-10", "app_date": "2025-06-10"}]
    drawings_status JSONB,

    -- Section 04: Intervention on Critical Issues
    scheduled_completion_date DATE,
    physical_progress_percent NUMERIC(5, 2),
    likely_completion_date DATE,
    drb_awards_authority INT DEFAULT 0,
    drb_awards_concessionaire INT DEFAULT 0,
    drb_awards_neutral INT DEFAULT 0,

    -- Section 05 & 06: COS and EOT
    cos_data JSONB,
    eot_data JSONB,

    -- Section 07: Contract Admin
    avg_processing_time_days VARCHAR(50), -- e.g., "7-15 days"
    spc_bills_data JSONB,

    -- Section 08 & 09: PCI and Safety
    pci_at_completion VARCHAR(50),
    pci_two_years_post VARCHAR(50),
    accidents_count VARCHAR(50),
    blackspots_count VARCHAR(50),
    safety_adherence_level VARCHAR(100),

    -- Section 10: NCR
    ncr_raised INT DEFAULT 0,
    ncr_closed INT DEFAULT 0,

    -- Section 11: Feedback (A and B)
    -- Format: {"nhai_feedback": [1, 5, 3...], "contractor_feedback": [4, 2...]}
    feedback_ratings JSONB,

    -- Section 12: Penal Action
    firm_debarments_3yr INT DEFAULT 0,
    financial_penalties_3yr INT DEFAULT 0,
    kp_suspensions_3yr INT DEFAULT 0,

    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submitted_by_code VARCHAR(50) -- The RO Code used for auth
);