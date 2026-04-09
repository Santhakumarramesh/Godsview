import { Router, Request, Response } from "express";
import {
  compileEvidencePacket,
  lockPacket,
  getPacket,
  getPacketsByStrategy,
  getAllPackets,
  EvidencePacket,
  BacktestEvidence,
  ValidationEvidence,
  ReadinessEvidence,
  CalibrationEvidence,
  RiskEvidence,
} from "../lib/evidence_packet";

const router = Router();

interface CompileBody {
  strategy_id: string;
  strategy_name: string;
  backtest?: BacktestEvidence;
  validation?: ValidationEvidence;
  readiness?: ReadinessEvidence;
  calibration?: CalibrationEvidence;
  risk?: RiskEvidence;
  compiled_by?: string;
}

// POST /api/evidence/compile
router.post("/compile", (req: Request<{}, {}, CompileBody>, res: Response) => {
  try {
    const packet = compileEvidencePacket(req.body);
    res.status(201).json({ success: true, data: packet });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(400).json({ success: false, error: msg });
  }
});

// POST /api/evidence/:id/lock
router.post("/:id/lock", (req: Request, res: Response) => {
  try {
    const result = lockPacket(req.params.id);
    if (result.success) {
      const packet = getPacket(req.params.id);
      res.json({ success: true, data: packet });
    } else {
      res.status(404).json({ success: false, error: result.error });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/evidence
router.get("/", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
    const packets = getAllPackets(limit);
    res.json({ success: true, data: packets });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/evidence/:id
router.get("/:id", (req: Request, res: Response) => {
  try {
    const packet = getPacket(req.params.id);
    if (packet) {
      res.json({ success: true, data: packet });
    } else {
      res.status(404).json({ success: false, error: "Packet not found" });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/evidence/strategy/:strategy_id
router.get("/strategy/:strategy_id", (req: Request, res: Response) => {
  try {
    const packets = getPacketsByStrategy(req.params.strategy_id);
    res.json({ success: true, data: packets });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

// GET /api/evidence/:id/verdict
router.get("/:id/verdict", (req: Request, res: Response) => {
  try {
    const packet = getPacket(req.params.id);
    if (packet) {
      res.json({
        success: true,
        data: {
          id: packet.id,
          verdict: packet.verdict,
          overall_score: packet.overall_score,
          blockers: packet.blockers,
          recommendations: packet.recommendations,
          locked: packet.locked,
        },
      });
    } else {
      res.status(404).json({ success: false, error: "Packet not found" });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({ success: false, error: msg });
  }
});

export default router;
