import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

// ── Full H&S folder template ─────────────────────────────────
const HS_STRUCTURE = [
  { key: 's1', label: 'Section 1 | H&S File', color: '#448a40', bg: '#e8f5e7', children: [] },
  { key: 's2', label: 'Section 2 | Project Directory', color: '#448a40', bg: '#e8f5e7', children: [] },
  { key: 's3', label: 'Section 3 | Record Drawings', color: '#378ADD', bg: '#E6F1FB', children: [
    { key: 's3-1', label: '3.1 As Built Drawings', children: [
      { key: 's3-1-01', label: '01. Superseded', children: [] },
      { key: 's3-1-02', label: '02. Unclassified', children: [] },
      { key: 's3-1-03', label: '03. Floor Plans', children: [] },
      { key: 's3-1-04', label: '04. Drawings', children: [
        { key: 's3-1-04-01', label: '01. Superseded', children: [] },
        { key: 's3-1-04-02', label: '02. Unclassified', children: [] },
        { key: 's3-1-04-03', label: '03. Fire Strategy', children: [] },
        { key: 's3-1-04-04', label: '04. Ceiling Layout', children: [] },
        { key: 's3-1-04-05', label: '05. Floor Setting Out Plan', children: [] },
        { key: 's3-1-04-06', label: '06. Floor Finishes', children: [] },
        { key: 's3-1-04-07', label: '07. Internal Wall Type', children: [] },
        { key: 's3-1-04-08', label: '08. External Wall Type', children: [] },
        { key: 's3-1-04-09', label: '09. Window and Door Code', children: [] },
        { key: 's3-1-04-10', label: '10. External Wall Setting Out', children: [] },
        { key: 's3-1-04-11', label: '11. Cavity Barrier Locations', children: [] },
        { key: 's3-1-04-12', label: '12. Proposed Stair Core', children: [] },
        { key: 's3-1-04-13', label: '13. Service Hole Setting Out', children: [] },
        { key: 's3-1-04-14', label: '14. Slab Setting Out', children: [] },
        { key: 's3-1-04-15', label: '15. Floor Plans', children: [] },
        { key: 's3-1-04-16', label: '16. Elevations', children: [] },
        { key: 's3-1-04-17', label: '17. Block Slab Edge', children: [] },
        { key: 's3-1-04-18', label: '18. Angled Brick Bay', children: [] },
        { key: 's3-1-04-19', label: '19. Lift Plan', children: [] },
        { key: 's3-1-04-20', label: '20. Sections AA BB CC', children: [] },
        { key: 's3-1-04-21', label: '21. Window Head Cill & Jamb', children: [] },
        { key: 's3-1-04-22', label: '22. Roof Detail & Type', children: [] },
        { key: 's3-1-04-23', label: '23. Special Shaped Bricks', children: [] },
        { key: 's3-1-04-24', label: '24. Bolt on Balcony', children: [] },
        { key: 's3-1-04-25', label: '25. Terrace', children: [] },
        { key: 's3-1-04-26', label: '26. Lift Overrun Junction', children: [] },
      ]},
      { key: 's3-1-05', label: '05. General Drawings', children: [
        { key: 's3-1-05-01', label: '01. Floor Area Measure', children: [] },
        { key: 's3-1-05-02', label: '02. Superseded', children: [] },
        { key: 's3-1-05-03', label: '03. Unclassified', children: [] },
        { key: 's3-1-05-04', label: '04. External Wall Detail', children: [] },
        { key: 's3-1-05-05', label: '05. External Doors', children: [] },
        { key: 's3-1-05-06', label: '06. Internal Doors', children: [] },
        { key: 's3-1-05-07', label: '07. Windows', children: [] },
        { key: 's3-1-05-08', label: '08. Substation', children: [] },
        { key: 's3-1-05-09', label: '09. Bathroom & Showers (Elevations)', children: [] },
        { key: 's3-1-05-10', label: '10. Internal Wall Types', children: [] },
        { key: 's3-1-05-11', label: '11. Separating Floor Types', children: [] },
        { key: 's3-1-05-12', label: '12. AOV Hatch', children: [] },
        { key: 's3-1-05-13', label: '13. Site Setting Out Plan', children: [] },
        { key: 's3-1-05-14', label: '14. Site Setting Out Externals', children: [] },
        { key: 's3-1-05-15', label: '15. Soffit Detail - Brick Wall', children: [] },
        { key: 's3-1-05-16', label: '16. Stone Detail External', children: [] },
        { key: 's3-1-05-17', label: '17. Brickwork Detail External', children: [] },
      ]},
    ]},
    { key: 's3-2', label: '3.2 Soft & Hard Landscaping', children: [] },
    { key: 's3-3', label: '3.3 Smoke Detector', children: [] },
    { key: 's3-4', label: '3.4 Sprinkler', children: [] },
  ]},
  { key: 's4', label: 'Section 4 | Construction Materials', color: '#BA7517', bg: '#FAEEDA', children: [
    { key: 's4-1', label: '4.1 Schedule of Equipment', children: [
      { key: 's4-1-01', label: '01. Walls - Plasterboard', children: [
        { key: 's4-1-01-01', label: '01. Siniat', children: [
          { key: 's4-1-01-01-01', label: '01. Blue - Sound', children: [] },
          { key: 's4-1-01-01-02', label: '02. Pink - Fire', children: [] },
          { key: 's4-1-01-01-03', label: '03. Green - Moisture', children: [] },
          { key: 's4-1-01-01-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's4-1-01-02', label: '02. Knauf', children: [
          { key: 's4-1-01-02-01', label: '01. Blue - Sound', children: [] },
          { key: 's4-1-01-02-02', label: '02. Pink - Fire', children: [] },
          { key: 's4-1-01-02-03', label: '03. Green - Moisture', children: [] },
          { key: 's4-1-01-02-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's4-1-01-03', label: '03. British Gypsum', children: [] },
        { key: 's4-1-01-00', label: '00. Unclassified', children: [] },
      ]},
      { key: 's4-1-02', label: '02. Doors', children: [
        { key: 's4-1-02-01', label: '01. Door Closer', children: [] },
        { key: 's4-1-02-02', label: '02. Door Stops - Ironmongery', children: [] },
        { key: 's4-1-02-03', label: '03. Doors', children: [] },
        { key: 's4-1-02-04', label: '04. Door Handles', children: [] },
      ]},
      { key: 's4-1-03', label: '03. Smoke Shaft', children: [] },
      { key: 's4-1-04', label: '04. Roof - Euro Clad', children: [] },
      { key: 's4-1-05', label: '05. Radiators', children: [
        { key: 's4-1-05-01', label: '01. Mylek Rads', children: [] },
        { key: 's4-1-05-02', label: '02. Bathrooms', children: [] },
      ]},
      { key: 's4-1-06', label: '06. Plumbing', children: [
        { key: 's4-1-06-01', label: '01. SVPs & RWPs', children: [] },
        { key: 's4-1-06-02', label: '02. Booster Set with Enhanced Controls', children: [] },
        { key: 's4-1-06-03', label: '03. Gas Safe Certificates', children: [] },
      ]},
      { key: 's4-1-07', label: '07. Electrical', children: [
        { key: 's4-1-07-01', label: '01. CCTV', children: [] },
        { key: 's4-1-07-02', label: '02. Electric', children: [] },
        { key: 's4-1-07-03', label: '03. Intercom', children: [] },
      ]},
      { key: 's4-1-08', label: '08. Mastics', children: [] },
      { key: 's4-1-09', label: '09. Insulation', children: [] },
      { key: 's4-1-10', label: '10. Lintels', children: [] },
      { key: 's4-1-11', label: '11. Bathrooms', children: [] },
      { key: 's4-1-12', label: '12. PV Panels', children: [] },
      { key: 's4-1-13', label: '13. Pipe Lagging', children: [] },
      { key: 's4-1-14', label: '14. MVHR', children: [] },
      { key: 's4-1-15', label: '15. Cylinders', children: [] },
      { key: 's4-1-16', label: '16. Flooring', children: [] },
      { key: 's4-1-17', label: '17. Fire Foam', children: [] },
      { key: 's4-1-18', label: '18. Lifts', children: [
        { key: 's4-1-18-01', label: '01. Maintenance Agreement', children: [] },
        { key: 's4-1-18-02', label: '02. Lift', children: [
          { key: 's4-1-18-02-01', label: '01. Owner Manual', children: [] },
          { key: 's4-1-18-02-02', label: '02. Declarations & Test Certs', children: [] },
          { key: 's4-1-18-02-03', label: '03. Drawings', children: [] },
          { key: 's4-1-18-02-04', label: '04. Service Contact Details', children: [] },
        ]},
      ]},
      { key: 's4-1-19', label: '19. Lighting', children: [] },
      { key: 's4-1-20', label: '20. Landscaping', children: [] },
      { key: 's4-1-21', label: '21. Lightning Conductor', children: [] },
      { key: 's4-1-22', label: '22. Plantroom Tanks', children: [] },
      { key: 's4-1-23', label: '23. Windows', children: [
        { key: 's4-1-23-01', label: '01. Acoustics Specs', children: [] },
        { key: 's4-1-23-02', label: '02. Design Specs', children: [] },
        { key: 's4-1-23-03', label: '03. Cills', children: [] },
      ]},
      { key: 's4-1-24', label: '24. Brickwork', children: [
        { key: 's4-1-24-01', label: '01. Bricks', children: [] },
        { key: 's4-1-24-02', label: '02. Mortar', children: [] },
      ]},
      { key: 's4-1-25', label: '25. Kitchens', children: [] },
      { key: 's4-1-26', label: '26. Wardrobes', children: [] },
      { key: 's4-1-27', label: '27. Access Panels', children: [] },
      { key: 's4-1-28', label: '28. Bike & Bin Store (External)', children: [] },
      { key: 's4-1-29', label: '29. Balcony', children: [
        { key: 's4-1-29-01', label: '01. As-Built GAs', children: [] },
        { key: 's4-1-29-02', label: '02. COSHH', children: [] },
        { key: 's4-1-29-03', label: '03. Structural Calculations', children: [] },
      ]},
      { key: 's4-1-30', label: '30. Fire System', children: [] },
      { key: 's4-1-31', label: '31. Sprinklers', children: [] },
      { key: 's4-1-32', label: '32. Residents Information', children: [] },
      { key: 's4-1-33', label: '33. Fire Sealant & Paint', children: [] },
      { key: 's4-1-34', label: '34. HVAC', children: [] },
    ]},
  ]},
  { key: 's5', label: 'Section 5 | Health and Safety', color: '#E24B4A', bg: '#FCEBEB', children: [
    { key: 's5-1', label: '5.1 Site Investigations, Environmental Reports & Soil Remediation', children: [] },
    { key: 's5-2', label: '5.2 Site Waste Management Plan (Record Information)', children: [] },
  ]},
  { key: 's6', label: 'Section 6 | Structural Design', color: '#888780', bg: '#F1EFE8', children: [
    { key: 's6-1', label: '6.1 Structural Designs - Principle', children: [] },
    { key: 's6-2', label: '6.2 Structural Engineer', children: [] },
  ]},
  { key: 's7', label: 'Section 7 | Services', color: '#378ADD', bg: '#E6F1FB', children: [
    { key: 's7-1', label: '7.1 Services Overview', children: [
      { key: 's7-1-01', label: '01. As Built Drawings', children: [
        { key: 's7-1-01-01', label: '01. Floor Plans', children: [] },
        { key: 's7-1-01-02', label: '02. Roof', children: [] },
      ]},
      { key: 's7-1-02', label: '02. As Built - Fire', children: [
        { key: 's7-1-02-01', label: '01. Unclassified', children: [] },
        { key: 's7-1-02-02', label: '02. As Fitted Drawings - As Wired Devices', children: [] },
        { key: 's7-1-02-03', label: '03. Fire Strategy', children: [] },
        { key: 's7-1-02-04', label: '04. Fire System Data', children: [
          { key: 's7-1-02-04-01', label: '01. Data Sheets', children: [] },
        ]},
      ]},
      { key: 's7-1-03', label: '03. Utilities', children: [
        { key: 's7-1-03-01', label: '01. Electrical', children: [] },
        { key: 's7-1-03-02', label: '02. Fibre', children: [] },
      ]},
    ]},
  ]},
  { key: 's8', label: 'Section 8 | O&M Manuals', color: '#534AB7', bg: '#EEEDFE', children: [
    { key: 's8-1', label: '8.1 Residents Information Pack', children: [] },
    { key: 's8-2', label: '8.2 Colour and Style Repair Replacement Information for Facade & Roof', children: [] },
    { key: 's8-3', label: '8.3 Cleaning and Maintenance', children: [] },
    { key: 's8-4', label: '8.4 Catalogue - All', children: [
      { key: 's8-4-01', label: '01. Walls - Plasterboard', children: [
        { key: 's8-4-01-01', label: '01. Siniat', children: [
          { key: 's8-4-01-01-01', label: '01. Blue - Sound', children: [] },
          { key: 's8-4-01-01-02', label: '02. Pink - Fire', children: [] },
          { key: 's8-4-01-01-03', label: '03. Green - Moisture', children: [] },
          { key: 's8-4-01-01-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's8-4-01-02', label: '02. Knauf', children: [
          { key: 's8-4-01-02-01', label: '01. Blue - Sound', children: [] },
          { key: 's8-4-01-02-02', label: '02. Pink - Fire', children: [] },
          { key: 's8-4-01-02-03', label: '03. Green - Moisture', children: [] },
          { key: 's8-4-01-02-04', label: '04. White - Standard', children: [] },
        ]},
        { key: 's8-4-01-03', label: '03. British Gypsum', children: [] },
        { key: 's8-4-01-00', label: '00. Unclassified', children: [] },
      ]},
      { key: 's8-4-02', label: '02. Doors', children: [
        { key: 's8-4-02-01', label: '01. Door Closer', children: [] },
        { key: 's8-4-02-02', label: '02. Door Stops - Ironmongery', children: [] },
        { key: 's8-4-02-03', label: '03. Doors', children: [] },
        { key: 's8-4-02-04', label: '04. Door Handles', children: [] },
      ]},
      { key: 's8-4-03', label: '03. Smoke Shaft', children: [] },
      { key: 's8-4-04', label: '04. Roof', children: [] },
      { key: 's8-4-05', label: '05. Radiators', children: [] },
      { key: 's8-4-06', label: '06. Plumbing', children: [
        { key: 's8-4-06-01', label: '01. SVPs & RWPs', children: [] },
        { key: 's8-4-06-02', label: '02. Booster Set with Enhanced Controls', children: [] },
        { key: 's8-4-06-03', label: '03. Gas Safe Certificates', children: [] },
      ]},
      { key: 's8-4-07', label: '07. Electrical', children: [
        { key: 's8-4-07-01', label: '01. CCTV', children: [] },
        { key: 's8-4-07-02', label: '02. Electric', children: [] },
        { key: 's8-4-07-03', label: '03. Intercom', children: [] },
      ]},
      { key: 's8-4-08', label: '08. Mastics', children: [] },
      { key: 's8-4-09', label: '09. Insulation', children: [] },
      { key: 's8-4-10', label: '10. Lintels', children: [] },
      { key: 's8-4-11', label: '11. Bathrooms', children: [] },
      { key: 's8-4-12', label: '12. PV Panels', children: [] },
      { key: 's8-4-13', label: '13. Power On', children: [
        { key: 's8-4-13-01', label: '01. Electrical Design Pack', children: [] },
        { key: 's8-4-13-02', label: '02. Fibre', children: [] },
        { key: 's8-4-13-03', label: '03. Electrical Design Pack', children: [] },
      ]},
      { key: 's8-4-14', label: '14. Pipe Lagging', children: [] },
      { key: 's8-4-15', label: '15. MVHR', children: [] },
      { key: 's8-4-16', label: '16. Cylinders', children: [] },
      { key: 's8-4-17', label: '17. Flooring', children: [
        { key: 's8-4-17-01', label: '01. Tiles', children: [] },
        { key: 's8-4-17-02', label: '02. Carpet Tile', children: [] },
      ]},
      { key: 's8-4-18', label: '18. Fire Foam', children: [] },
      { key: 's8-4-19', label: '19. Lifts', children: [
        { key: 's8-4-19-01', label: '01. Maintenance Agreement', children: [] },
        { key: 's8-4-19-02', label: '02. Lift', children: [
          { key: 's8-4-19-02-01', label: '01. Owner Manual', children: [] },
          { key: 's8-4-19-02-02', label: '02. Declarations & Test Certs', children: [] },
          { key: 's8-4-19-02-03', label: '03. Drawings', children: [] },
          { key: 's8-4-19-02-04', label: '04. Service Contact Details', children: [] },
        ]},
      ]},
      { key: 's8-4-20', label: '20. Lighting', children: [] },
      { key: 's8-4-21', label: '21. Landscaping', children: [] },
      { key: 's8-4-22', label: '22. Lightning Conductor', children: [] },
      { key: 's8-4-23', label: '23. Plantroom Tanks', children: [] },
      { key: 's8-4-24', label: '24. Windows', children: [
        { key: 's8-4-24-01', label: '01. Acoustics Specs', children: [] },
        { key: 's8-4-24-02', label: '02. Design Spec', children: [] },
        { key: 's8-4-24-03', label: '03. Cills', children: [] },
      ]},
      { key: 's8-4-25', label: '25. Brickwork', children: [
        { key: 's8-4-25-01', label: '01. Bricks', children: [] },
        { key: 's8-4-25-02', label: '02. Mortar', children: [] },
      ]},
      { key: 's8-4-26', label: '26. Kitchens', children: [] },
      { key: 's8-4-27', label: '27. Wardrobes', children: [] },
      { key: 's8-4-28', label: '28. Access Panels', children: [] },
      { key: 's8-4-29', label: '29. Bike & Bin Store (External)', children: [] },
      { key: 's8-4-30', label: '30. Balcony', children: [
        { key: 's8-4-30-01', label: '01. As-Built GAs', children: [] },
        { key: 's8-4-30-02', label: '02. COSHH', children: [] },
        { key: 's8-4-30-03', label: '03. Structural Calculations', children: [] },
      ]},
      { key: 's8-4-31', label: '31. Fire System', children: [
        { key: 's8-4-31-01', label: '01. Data Sheets', children: [] },
      ]},
      { key: 's8-4-32', label: '32. Sprinklers', children: [] },
      { key: 's8-4-33', label: '33. Residents Information', children: [] },
      { key: 's8-4-34', label: '34. Fire Sealant & Paint', children: [] },
      { key: 's8-4-35', label: '35. HVAC', children: [] },
      { key: 's8-4-36', label: '36. Paint', children: [] },
      { key: 's8-4-37', label: '37. OFNL', children: [] },
    ]},
  ]},
  { key: 's9', label: 'Section 9 | Commissioning Documents', color: '#0F6E56', bg: '#E1F5EE', children: [
    { key: 's9-1', label: '9.1 Commissioning Records (Part 1)', children: [] },
    { key: 's9-2', label: '9.2 Commissioning Records (Part 2)', children: [] },
  ]},
  { key: 's10', label: 'Section 10 | Operating Documents', color: '#0F6E56', bg: '#E1F5EE', children: [
    { key: 's10-1', label: '10.1 Operating Records', children: [] },
  ]},
  { key: 's11', label: 'Section 11 | Certificates', color: '#993C1D', bg: '#FAECE7', children: [
    { key: 's11-1', label: '11.1 Building Control & Building Insurance', children: [
      { key: 's11-1-01', label: '01. Flats Certs', children: [] },
      { key: 's11-1-02', label: '02. Building Insurance', children: [] },
    ]},
    { key: 's11-2', label: '11.2 Emergency Lighting Safety Certificate', children: [
      { key: 's11-2-01', label: '01. Communal Lighting', children: [] },
      { key: 's11-2-02', label: '02. Emergency Lighting', children: [] },
    ]},
    { key: 's11-3', label: '11.3 Electrical Safety Certificate', children: [
      { key: 's11-3-01', label: '01. EICR', children: [] },
    ]},
    { key: 's11-4', label: '11.4 Fire Alarm Certificate', children: [
      { key: 's11-4-01', label: '01. Commissioning Certificates', children: [] },
    ]},
    { key: 's11-5', label: '11.5 AOV & Smoke Shaft', children: [] },
    { key: 's11-6', label: '11.6 Dry Riser Commissioning', children: [] },
    { key: 's11-7', label: '11.7 Lift Commissioning', children: [
      { key: 's11-7-01', label: '01. Declarations & Test Certs', children: [] },
      { key: 's11-7-02', label: '02. Lift', children: [
        { key: 's11-7-02-01', label: '01. Owner Manual', children: [] },
        { key: 's11-7-02-02', label: '02. Drawings', children: [] },
        { key: 's11-7-02-03', label: '03. Service Contact Details', children: [] },
      ]},
    ]},
    { key: 's11-8', label: '11.8 Energy Performance Certificates & SAP', children: [
      { key: 's11-8-01', label: '01. EPCs', children: [] },
      { key: 's11-8-02', label: '02. SAPs', children: [] },
    ]},
    { key: 's11-9', label: '11.9 Air & Sound Test Certificates', children: [
      { key: 's11-9-01', label: '01. MVHR Air Test', children: [] },
      { key: 's11-9-02', label: '02. Air Permeability Test', children: [] },
      { key: 's11-9-03', label: '03. Sound Test', children: [] },
    ]},
    { key: 's11-10', label: '11.10 Fire Stopping Certificate', children: [] },
    { key: 's11-11', label: '11.11 Water Efficiency Certs (Block)', children: [] },
    { key: 's11-12', label: '11.12 Planning Approval & Condition Sign Off', children: [] },
  ]},
]

// ── Helpers ───────────────────────────────────────────────────
function getAllKeys(nodes, acc = []) {
  nodes.forEach(n => { acc.push(n.key); if (n.children?.length) getAllKeys(n.children, acc) })
  return acc
}

function getAllLeafKeys(nodes, acc = []) {
  nodes.forEach(n => {
    if (!n.children?.length) acc.push(n.key)
    else getAllLeafKeys(n.children, acc)
  })
  return acc
}

function findSection(nodes, key) {
  for (const n of nodes) {
    if (n.key === key) return n
    if (n.children?.length) {
      const found = findSection(n.children, key)
      if (found) return found
    }
  }
  return null
}

function fmtSize(b) {
  if (!b) return ''
  if (b < 1024) return b + 'B'
  if (b < 1048576) return (b / 1024).toFixed(0) + 'KB'
  return (b / 1048576).toFixed(1) + 'MB'
}

function getColor(node, depth) {
  if (node.color) return node.color
  return '#888780'
}

// ── File Card ─────────────────────────────────────────────────
function HSFileCard({ file, onDelete, canDelete }) {
  const [url, setUrl] = useState(null)
  const isPdf = file.file_name?.toLowerCase().endsWith('.pdf')
  const isImg = /\.(jpg|jpeg|png|gif|webp)$/i.test(file.file_name || '')
  const ext = file.file_name?.split('.').pop()?.toUpperCase().slice(0, 4) || '?'

  useEffect(() => {
    supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (data?.signedUrl) setUrl(data.signedUrl) })
  }, [file.storage_path])

  async function download() {
    const { data } = await supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 60)
    if (data?.signedUrl) { const a = document.createElement('a'); a.href = data.signedUrl; a.download = file.file_name; a.click() }
  }

  return (
    <div style={{ border: '0.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: 'var(--surface)', fontSize: 12 }}>
      <div style={{ height: 120, background: 'var(--surface2)', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {isImg && url
          ? <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : isPdf && url
          ? <iframe src={url + '#page=1&toolbar=0&navpanes=0&scrollbar=0'} style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }} title={file.file_name} />
          : <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="1"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        }
        <div style={{ position: 'absolute', top: 5, right: 5, background: 'rgba(0,0,0,0.55)', color: 'white', fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3 }}>{ext}</div>
      </div>
      <div style={{ padding: '7px 9px' }}>
        <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)', marginBottom: 2 }} title={file.file_name}>{file.file_name}</div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 6 }}>{fmtSize(file.file_size)}{file.file_size ? ' · ' : ''}{new Date(file.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</div>
        <div style={{ display: 'flex', gap: 4 }}>
          {url && <button onClick={() => window.open(url, '_blank')} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>View</button>}
          <button onClick={download} style={{ flex: 1, fontSize: 10, padding: '3px 0', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>↓</button>
          {canDelete && <button onClick={onDelete} style={{ fontSize: 10, padding: '3px 6px', border: '0.5px solid var(--red-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--red)' }}>✕</button>}
        </div>
      </div>
    </div>
  )
}

// ── Folder Node (recursive, handles all depths) ───────────────
function FolderNode({ node, projectId, depth, fileCounts, canManage, canAddFolders, customFolders, onCustomFolderAdded, sectionColor }) {
  const [open, setOpen] = useState(false)
  const [files, setFiles] = useState([])
  const [uploading, setUploading] = useState(false)
  const [showAddFolder, setShowAddFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const color = node.color || sectionColor || '#888780'
  const bg = node.bg || '#F1EFE8'
  const fileCount = fileCounts?.[node.key] || 0
  const isSection = depth === 0
  const indent = depth * 14

  // Custom sub-folders for this node
  const myCustomFolders = (customFolders || []).filter(f => f.parent_key === node.key)

  useEffect(() => {
    if (open) loadFiles()
  }, [open])

  async function loadFiles() {
    const { data } = await supabase.from('hs_files').select('*')
      .eq('project_id', projectId).eq('folder_key', node.key).order('created_at', { ascending: false })
    setFiles(data || [])
  }

  async function upload(fileList) {
    if (!fileList.length) return
    setUploading(true)
    for (const file of fileList) {
      const path = `projects/${projectId}/hs/${node.key}/${Date.now()}-${file.name}`
      const { error } = await supabase.storage.from('hs-handover').upload(path, file)
      if (!error) {
        await supabase.from('hs_files').insert({ project_id: projectId, folder_key: node.key, storage_path: path, file_name: file.name, file_size: file.size })
      }
    }
    setUploading(false)
    loadFiles()
  }

  async function deleteFile(f) {
    await supabase.storage.from('hs-handover').remove([f.storage_path])
    await supabase.from('hs_files').delete().eq('id', f.id)
    setConfirmDelete(null)
    setFiles(prev => prev.filter(x => x.id !== f.id))
  }

  async function addCustomFolder() {
    if (!newFolderName.trim()) return
    const key = `custom-${node.key}-${Date.now()}`
    await supabase.from('hs_folders').insert({ project_id: projectId, parent_key: node.key, folder_key: key, label: newFolderName.trim() })
    setNewFolderName('')
    setShowAddFolder(false)
    onCustomFolderAdded()
  }

  async function zipFolder() {
    const { data: allFiles } = await supabase.from('hs_files').select('*').eq('project_id', projectId).eq('folder_key', node.key)
    if (!allFiles?.length) { alert('No files in this folder.'); return }
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
    script.onload = async () => {
      const zip = new window.JSZip()
      for (const f of allFiles) {
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(f.storage_path, 300)
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl)
          zip.file(f.file_name, await resp.blob())
        }
      }
      const content = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(content); a.download = `${node.label}.zip`; a.click()
    }
    document.head.appendChild(script)
  }

  const hasChildren = (node.children?.length > 0) || myCustomFolders.length > 0
  const totalCount = fileCount + (node.children || []).reduce((s, c) => s + (fileCounts?.[c.key] || 0), 0)

  return (
    <div style={{ marginLeft: indent > 0 ? 0 : 0 }}>
      {/* Folder row */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: isSection ? '11px 14px' : '8px 12px',
          borderRadius: isSection ? 8 : 6,
          cursor: 'pointer',
          background: isSection ? 'var(--surface)' : open ? 'var(--surface2)' : 'transparent',
          border: isSection ? `0.5px solid var(--border)` : 'none',
          borderLeft: isSection ? `3px solid ${color}` : depth === 1 ? `2px solid ${color}40` : 'none',
          marginBottom: isSection ? 5 : 2,
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => { if (!isSection && !open) e.currentTarget.style.background = 'var(--surface2)' }}
        onMouseLeave={e => { if (!isSection && !open) e.currentTarget.style.background = 'transparent' }}
      >
        {/* Folder icon */}
        <div style={{ width: isSection ? 32 : 24, height: isSection ? 32 : 24, borderRadius: 5, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width={isSection ? 16 : 13} height={isSection ? 16 : 13} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>

        {/* Label */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: isSection ? 13 : 12, fontWeight: isSection ? 600 : 500, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{node.label}</div>
          {totalCount > 0 && <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 1 }}>{totalCount} file{totalCount !== 1 ? 's' : ''}</div>}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {open && (
            <>
              <button onClick={zipFolder} style={{ fontSize: 10, padding: '3px 8px', border: '0.5px solid var(--border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>Zip</button>
              {canManage && (
                <label style={{ fontSize: 10, padding: '3px 8px', border: `0.5px solid ${color}`, borderRadius: 4, background: 'transparent', cursor: 'pointer', color }}>
                  {uploading ? '...' : '+ Upload'}
                  <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} disabled={uploading} />
                </label>
              )}
            </>
          )}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth="2" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      {/* Open content */}
      {open && (
        <div style={{ marginLeft: isSection ? 16 : 12, paddingLeft: 10, borderLeft: `1.5px solid ${color}30`, marginBottom: isSection ? 8 : 4, paddingTop: 4, paddingBottom: 4 }}>
          {/* Sub-folders */}
          {node.children?.map(child => (
            <FolderNode key={child.key} node={child} projectId={projectId} depth={depth + 1}
              fileCounts={fileCounts} canManage={canManage} canAddFolders={canAddFolders}
              customFolders={customFolders} onCustomFolderAdded={onCustomFolderAdded}
              sectionColor={color} />
          ))}

          {/* Custom sub-folders */}
          {myCustomFolders.map(cf => (
            <FolderNode key={cf.folder_key}
              node={{ key: cf.folder_key, label: cf.label, children: [] }}
              projectId={projectId} depth={depth + 1}
              fileCounts={fileCounts} canManage={canManage} canAddFolders={canAddFolders}
              customFolders={customFolders} onCustomFolderAdded={onCustomFolderAdded}
              sectionColor={color} />
          ))}

          {/* Files grid */}
          {files.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginTop: 8, marginBottom: 8 }}>
              {files.map(f => (
                <HSFileCard key={f.id} file={f} onDelete={() => setConfirmDelete(f)} canDelete={canManage} />
              ))}
            </div>
          )}

          {/* Upload area if no files */}
          {files.length === 0 && !hasChildren && canManage && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, border: '0.5px dashed var(--border)', borderRadius: 6, cursor: 'pointer', color: 'var(--text3)', fontSize: 11, margin: '4px 0' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Drop files here or click to upload
              <input type="file" multiple style={{ display: 'none' }} onChange={e => upload(Array.from(e.target.files))} />
            </label>
          )}

          {files.length === 0 && !hasChildren && !canManage && (
            <div style={{ fontSize: 11, color: 'var(--text3)', padding: '8px 0', fontStyle: 'italic' }}>Empty folder</div>
          )}

          {/* Add custom folder button */}
          {canAddFolders && (
            showAddFolder ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 0' }}>
                <input autoFocus value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addCustomFolder(); if (e.key === 'Escape') setShowAddFolder(false) }}
                  placeholder="Folder name..." style={{ flex: 1, fontSize: 11, padding: '4px 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'var(--surface)', color: 'var(--text)' }} />
                <button onClick={addCustomFolder} disabled={!newFolderName.trim()} style={{ fontSize: 11, padding: '4px 8px', background: color, color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer' }}>Add</button>
                <button onClick={() => setShowAddFolder(false)} style={{ fontSize: 11, padding: '4px 8px', border: '0.5px solid var(--border)', borderRadius: 5, background: 'transparent', cursor: 'pointer', color: 'var(--text2)' }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setShowAddFolder(true)} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '4px 8px', border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text3)', marginTop: 2 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add sub-folder
              </button>
            )
          )}
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setConfirmDelete(null)}>
          <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 24, maxWidth: 360, width: '90%' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete file?</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>"{confirmDelete.file_name}" will be permanently deleted.</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => deleteFile(confirmDelete)}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main HSHandover component ─────────────────────────────────
export default function HSHandover({ projectId, projectName }) {
  const { can } = useAuth()
  const [fileCounts, setFileCounts] = useState({})
  const [customFolders, setCustomFolders] = useState([])
  const [compilingFull, setCompilingFull] = useState(false)
  const [compilingOm, setCompilingOm] = useState(false)

  const canManage = can('manage_projects')
  const canAddFolders = can('manage_projects')

  useEffect(() => {
    loadFileCounts()
    loadCustomFolders()
  }, [projectId])

  async function loadFileCounts() {
    const { data } = await supabase.from('hs_files').select('folder_key').eq('project_id', projectId)
    if (data) {
      const counts = {}
      data.forEach(f => { counts[f.folder_key] = (counts[f.folder_key] || 0) + 1 })
      setFileCounts(counts)
    }
  }

  async function loadCustomFolders() {
    const { data } = await supabase.from('hs_folders').select('*').eq('project_id', projectId).order('created_at')
    setCustomFolders(data || [])
  }

  const totalFiles = Object.values(fileCounts).reduce((a, b) => a + b, 0)

  async function compileHandover(sectionKeys, filename) {
    // Load pdf-lib
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
    document.head.appendChild(script)
    await new Promise(r => script.onload = r)

    const { PDFDocument, rgb, StandardFonts, PageSizes } = window.PDFLib

    const merged = await PDFDocument.create()
    const boldFont = await merged.embedFont(StandardFonts.HelveticaBold)
    const regFont = await merged.embedFont(StandardFonts.Helvetica)

    // ── Cover page ────────────────────────────────────────────
    const cover = merged.addPage(PageSizes.A4)
    const { width, height } = cover.getSize()

    // Green header bar
    cover.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: rgb(0.267, 0.541, 0.251) })
    cover.drawText('CITY CONSTRUCTION LTD', { x: 40, y: height - 55, size: 22, font: boldFont, color: rgb(1, 1, 1) })
    cover.drawText('cltd.co.uk', { x: 40, y: height - 80, size: 12, font: regFont, color: rgb(0.9, 0.9, 0.9) })

    // Title
    cover.drawText(filename.replace('.pdf', ''), { x: 40, y: height - 200, size: 28, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
    cover.drawText(projectName || 'Project', { x: 40, y: height - 240, size: 16, font: regFont, color: rgb(0.4, 0.4, 0.4) })
    cover.drawText(`Generated: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, { x: 40, y: height - 270, size: 12, font: regFont, color: rgb(0.5, 0.5, 0.5) })

    // Footer
    cover.drawRectangle({ x: 0, y: 0, width, height: 40, color: rgb(0.267, 0.541, 0.251) })
    cover.drawText('Confidential — City Construction Ltd', { x: 40, y: 14, size: 10, font: regFont, color: rgb(1, 1, 1) })

    // ── Collect all PDF files ─────────────────────────────────
    const query = sectionKeys ? supabase.from('hs_files').select('*').eq('project_id', projectId).in('folder_key', sectionKeys) : supabase.from('hs_files').select('*').eq('project_id', projectId)
    const { data: allFiles } = await query.order('folder_key').order('file_name')

    const pdfFiles = (allFiles || []).filter(f => f.file_name?.toLowerCase().endsWith('.pdf'))
    const otherFiles = (allFiles || []).filter(f => !f.file_name?.toLowerCase().endsWith('.pdf'))

    let currentSection = null

    for (const file of pdfFiles) {
      // Add section divider page if section changed
      const section = HS_STRUCTURE.find(s => file.folder_key.startsWith(s.key))
      if (section && section.key !== currentSection) {
        currentSection = section.key
        const divPage = merged.addPage(PageSizes.A4)
        divPage.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.97, 0.97, 0.97) })
        divPage.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: rgb(0.267, 0.541, 0.251) })
        divPage.drawText(section.label, { x: 40, y: height / 2 + 20, size: 24, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
        divPage.drawText(projectName || '', { x: 40, y: height / 2 - 10, size: 14, font: regFont, color: rgb(0.5, 0.5, 0.5) })
      }

      try {
        const { data } = await supabase.storage.from('hs-handover').createSignedUrl(file.storage_path, 300)
        if (data?.signedUrl) {
          const resp = await fetch(data.signedUrl)
          const bytes = await resp.arrayBuffer()
          const srcDoc = await PDFDocument.load(bytes)
          const pages = await merged.copyPages(srcDoc, srcDoc.getPageIndices())
          pages.forEach(p => merged.addPage(p))
        }
      } catch (e) { console.warn('Could not embed:', file.file_name) }
    }

    // ── Appendix: non-PDF file index ─────────────────────────
    if (otherFiles.length > 0) {
      const appendix = merged.addPage(PageSizes.A4)
      appendix.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: rgb(0.267, 0.541, 0.251) })
      appendix.drawText('Appendix — Additional Files', { x: 40, y: height - 60, size: 18, font: boldFont, color: rgb(0.1, 0.1, 0.1) })
      appendix.drawText('The following files are included in the project but cannot be embedded in PDF format:', { x: 40, y: height - 90, size: 11, font: regFont, color: rgb(0.4, 0.4, 0.4) })
      let y = height - 130
      for (const f of otherFiles) {
        if (y < 60) break
        appendix.drawText(`• ${f.file_name}`, { x: 50, y, size: 10, font: regFont, color: rgb(0.2, 0.2, 0.2) })
        y -= 18
      }
    }

    const bytes = await merged.save()
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click()
  }

  async function compileFullHandover() {
    setCompilingFull(true)
    try {
      await compileHandover(null, `${projectName || 'Project'} — H&S Handover File.pdf`)
    } catch (e) { alert('Error compiling PDF: ' + e.message) }
    setCompilingFull(false)
  }

  async function compileOmManuals() {
    setCompilingOm(true)
    try {
      // Get all keys under Section 8
      const s8 = HS_STRUCTURE.find(s => s.key === 's8')
      const s8Keys = getAllKeys([s8])
      await compileHandover(s8Keys, `${projectName || 'Project'} — Section 8 O&M Manuals.pdf`)
    } catch (e) { alert('Error compiling PDF: ' + e.message) }
    setCompilingOm(false)
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>H&S Handover File</div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{totalFiles} file{totalFiles !== 1 ? 's' : ''} · Sections 1–11</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={compileOmManuals} disabled={compilingOm} style={{ fontSize: 12, padding: '7px 14px', border: '0.5px solid #534AB7', borderRadius: 6, background: 'transparent', cursor: 'pointer', color: '#534AB7', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {compilingOm ? 'Compiling...' : 'Export Section 8 O&M PDF'}
          </button>
          <button onClick={compileFullHandover} disabled={compilingFull} style={{ fontSize: 12, padding: '7px 14px', border: '0.5px solid var(--border)', borderRadius: 6, background: '#448a40', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            {compilingFull ? 'Compiling...' : 'Compile Full H&S Handover PDF'}
          </button>
        </div>
      </div>

      {/* Section folders */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
        {HS_STRUCTURE.map(section => (
          <FolderNode
            key={section.key}
            node={section}
            projectId={projectId}
            depth={0}
            fileCounts={fileCounts}
            canManage={canManage}
            canAddFolders={canAddFolders}
            customFolders={customFolders}
            onCustomFolderAdded={() => { loadCustomFolders(); loadFileCounts() }}
            sectionColor={section.color}
          />
        ))}
      </div>

      {/* Note */}
      <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 8, fontSize: 11, color: 'var(--text3)' }}>
        Template structure fixed — add sub-folders within sections as needed per project. Only PDFs are embedded in compiled exports; other file types appear in the appendix index.
      </div>
    </div>
  )
}
