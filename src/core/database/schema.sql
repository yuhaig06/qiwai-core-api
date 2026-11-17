-- QIWAI Core schema (MySQL)
CREATE DATABASE IF NOT EXISTS qiwai_core CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE qiwai_core;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    phone_or_email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    trust_score INT DEFAULT 100,
    plan ENUM('free','pro') NOT NULL DEFAULT 'free',
    scan_date DATE NULL,
    scan_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS risk_entities (
    id INT AUTO_INCREMENT PRIMARY KEY,
    entity_type ENUM('PHONE', 'URL', 'TEXT_PATTERN') NOT NULL,
    entity_value VARCHAR(500) NOT NULL,
    risk_level ENUM('SAFE', 'SUSPICIOUS', 'DANGEROUS') NOT NULL,
    risk_score INT NOT NULL DEFAULT 0,
    ai_analysis TEXT,
    report_count INT DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_entity (entity_type, entity_value(255))
);

CREATE TABLE IF NOT EXISTS urban_pulses (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    pulse_type ENUM('FLOOD', 'TRAFFIC_JAM', 'CONSTRUCTION', 'SECURITY', 'ALL_CLEAR') NOT NULL,
    latitude DECIMAL(10, 8) NOT NULL,
    longitude DECIMAL(11, 8) NOT NULL,
    geohash VARCHAR(12) NOT NULL,
    description VARCHAR(255),
    evidence TEXT NULL,
    status ENUM('PENDING_AI', 'PENDING_VERIFY', 'VERIFIED', 'EXPIRED') DEFAULT 'PENDING_VERIFY',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_geohash_status (geohash, status)
);
