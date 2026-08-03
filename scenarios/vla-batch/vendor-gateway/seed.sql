-- Seed for the SQL Server island. Synthetic values only (PR-15): no real
-- suppliers, no real batch codes, no real asset numbers.
--
-- Note EQ_TAG. This system calls the cook unit CK-UNIT-1 while the line calls it
-- cook-unit-01, and that single fact is why maintenance load has never appeared
-- next to process performance in any report. No units to convert, no protocol
-- gap: just two names for one machine and nobody wrote the mapping down.
IF DB_ID('PLANT') IS NULL CREATE DATABASE PLANT;
GO
USE PLANT;
GO

IF OBJECT_ID('LAB_RESULT') IS NULL
CREATE TABLE LAB_RESULT (
  SAMPLE_ID  VARCHAR(24) NOT NULL,
  EQ_TAG     VARCHAR(24) NOT NULL,
  PARAM      VARCHAR(24) NOT NULL,
  VALUE      FLOAT       NOT NULL,
  UOM        VARCHAR(8)  NOT NULL,
  TAKEN_AT   DATETIME    NOT NULL,   -- UTC, this system got it right
  ANALYST    VARCHAR(24) NULL
);
GO

IF OBJECT_ID('WO_HDR') IS NULL
CREATE TABLE WO_HDR (
  WO_ID     VARCHAR(16) NOT NULL,
  EQ_TAG    VARCHAR(24) NOT NULL,    -- the vendor's own asset naming
  WO_TYPE   VARCHAR(16) NOT NULL,
  STATUS    VARCHAR(16) NOT NULL,
  PRIORITY  INT         NOT NULL,
  OPEN_DT   DATETIME    NOT NULL,
  CLOSE_DT  DATETIME    NULL
);
GO

IF OBJECT_ID('METER_READING') IS NULL
CREATE TABLE METER_READING (
  TAG       VARCHAR(24) NOT NULL,
  VALUE     FLOAT       NOT NULL,
  UOM       VARCHAR(8)  NOT NULL,
  TS_LOCAL  DATETIME    NOT NULL     -- wall clock, NO offset. The defect.
);
GO

DELETE FROM WO_HDR;
INSERT INTO WO_HDR VALUES
 ('WO-1001','CK-UNIT-1','PREVENTIVE','OPEN',2,GETDATE(),NULL),
 ('WO-1002','CK-UNIT-1','CORRECTIVE','OPEN',1,GETDATE(),NULL),
 ('WO-1003','HOM-1101','PREVENTIVE','OPEN',3,GETDATE(),NULL),
 ('WO-1004','FLR-1','CORRECTIVE','OPEN',1,GETDATE(),NULL),
 ('WO-1005','FLR-1','PREVENTIVE','OPEN',3,GETDATE(),NULL),
 ('WO-1006','FLR-1','INSPECTION','OPEN',3,GETDATE(),NULL),
 ('WO-1007','CHL-1','PREVENTIVE','CLOSED',3,GETDATE(),GETDATE());
GO
