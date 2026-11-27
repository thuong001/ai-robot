
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { RobotState } from "../types/robot";

interface RobotCanvasProps {
  robotState: RobotState;
  getAudioLevels: () => {
    speechLevel: number;
    micLevel: number;
  };
}

export function RobotCanvas({
  robotState,
  getAudioLevels,
}: RobotCanvasProps) {
  const [audioLevel, setAudioLevel] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const levels = getAudioLevels();
      setAudioLevel(
        Math.min(1, Math.max(levels.speechLevel, levels.micLevel))
      );
    }, 100);

    return () => window.clearInterval(timer);
  }, [getAudioLevels]);

  const glow = 12 + audioLevel * 35;

  const robotStyle = {
    "--robot-glow": `${glow}px`,
    "--robot-scale": `${1 + audioLevel * 0.025}`,
  } as CSSProperties;

  return (
    <div
      className={`robot-scene robot-${robotState}`}
      style={robotStyle}
      role="img"
      aria-label="Người máy AI ROBOT 3D"
    >
      <style>{`
        .robot-scene {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          perspective: 1000px;
          overflow: hidden;
          background:
            radial-gradient(ellipse at 50% 48%, #142b48 0%, #091426 42%, #060a14 78%);
        }

        .robot-floor {
          position: absolute;
          width: 270px;
          height: 55px;
          bottom: 17%;
          border-radius: 50%;
          background: #00cfff;
          opacity: .15;
          filter: blur(30px);
        }

        .robot-body {
          position: relative;
          width: 220px;
          height: 390px;
          transform-style: preserve-3d;
          transform: rotateY(-12deg) scale(var(--robot-scale));
          transition: transform .2s ease;
          animation: robot-float 4s ease-in-out infinite;
          filter: drop-shadow(0 0 var(--robot-glow) #00bfff);
        }

        .robot-head {
          position: absolute;
          width: 116px;
          height: 105px;
          left: 52px;
          top: 8px;
          border-radius: 35px 35px 30px 30px;
          background: linear-gradient(145deg, #f1fbff, #7194b7 45%, #243b59);
          border: 3px solid #a9eaff;
          box-shadow: inset -12px -10px 20px #071a32, 0 0 24px #00bfff;
          z-index: 4;
        }

        .robot-face {
          position: absolute;
          inset: 17px 12px;
          border-radius: 22px;
          background: linear-gradient(145deg, #102b49, #020b19);
          border: 2px solid #3d9fc8;
        }

        .robot-eyes {
          display: flex;
          justify-content: space-around;
          padding-top: 27px;
        }

        .robot-eye {
          width: 18px;
          height: 10px;
          border-radius: 50%;
          background: #4cf4ff;
          box-shadow: 0 0 14px #00eaff;
          animation: robot-blink 4s infinite;
        }

        .robot-mouth {
          width: 30px;
          height: 4px;
          margin: 13px auto 0;
          border-radius: 10px;
          background: #24dfff;
          box-shadow: 0 0 9px #00dfff;
        }

        .robot-ear {
          position: absolute;
          top: 43px;
          width: 15px;
          height: 31px;
          border-radius: 8px;
          background: linear-gradient(90deg, #263e5a, #b6eaff);
          border: 2px solid #65cfff;
        }

        .robot-ear.left { left: -12px; }
        .robot-ear.right { right: -12px; }

        .robot-neck {
          position: absolute;
          top: 108px;
          left: 94px;
          width: 32px;
          height: 27px;
          background: linear-gradient(90deg, #203954, #b8eaff, #203954);
        }

        .robot-torso {
          position: absolute;
          top: 127px;
          left: 37px;
          width: 146px;
          height: 132px;
          border-radius: 28px 28px 35px 35px;
          background: linear-gradient(125deg, #e9faff, #6389a9 35%, #172d49 80%);
          border: 3px solid #a2e7ff;
          box-shadow: inset -15px -12px 20px #07182b, 0 0 20px #168cc4;
          z-index: 3;
        }

        .robot-chest {
          position: absolute;
          top: 27px;
          left: 39px;
          width: 66px;
          height: 66px;
          border-radius: 50%;
          border: 4px solid #54dfff;
          background: radial-gradient(circle, #d9ffff, #00a9e9 35%, #082e59 75%);
          box-shadow: 0 0 22px #00cfff, inset 0 0 14px #fff;
          animation: robot-pulse 2s infinite ease-in-out;
        }

        .robot-arm {
          position: absolute;
          top: 139px;
          width: 31px;
          height: 115px;
          border-radius: 18px;
          background: linear-gradient(90deg, #152b45, #b8eaff, #385776);
          border: 2px solid #72c8e9;
          transform-origin: top center;
        }

        .robot-arm.left {
          left: 12px;
          transform: rotate(12deg);
        }

        .robot-arm.right {
          right: 12px;
          transform: rotate(-12deg);
        }

        .robot-hand {
          position: absolute;
          bottom: -15px;
          left: 2px;
          width: 24px;
          height: 27px;
          border-radius: 10px;
          background: linear-gradient(135deg, #e9ffff, #426789);
          border: 2px solid #71dfff;
        }

        .robot-waist {
          position: absolute;
          top: 252px;
          left: 57px;
          width: 106px;
          height: 30px;
          border-radius: 10px;
          background: linear-gradient(90deg, #1c3550, #b1eaff, #1c3550);
          border: 2px solid #75d5f5;
        }

        .robot-leg {
          position: absolute;
          top: 278px;
          width: 42px;
          height: 88px;
          border-radius: 12px 12px 18px 18px;
          background: linear-gradient(90deg, #172d48, #b1eaff 50%, #294565);
          border: 2px solid #78cbea;
        }

        .robot-leg.left { left: 60px; }
        .robot-leg.right { right: 60px; }

        .robot-foot {
          position: absolute;
          bottom: -10px;
          left: -9px;
          width: 58px;
          height: 23px;
          border-radius: 12px 12px 8px 8px;
          background: linear-gradient(90deg, #14263e, #8dc8e6);
          border: 2px solid #6cc9ef;
        }

        .robot-status-light {
          position: absolute;
          top: 30%;
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #3df5ff;
          box-shadow: 0 0 13px #00eaff;
        }

        .robot-listening .robot-eye,
        .robot-listening .robot-chest {
          background-color: #24ffb5;
          box-shadow: 0 0 24px #00ffae;
        }

        .robot-speaking .robot-mouth {
          height: 10px;
          border-radius: 50%;
          animation: robot-talk .25s infinite alternate;
        }

        .robot-thinking .robot-head {
          animation: robot-think 2s infinite ease-in-out;
        }

        .robot-error .robot-chest {
          border-color: #ff657e;
        }

        @keyframes robot-float {
          0%, 100% { translate: 0 0; }
          50% { translate: 0 -9px; }
        }

        @keyframes robot-pulse {
          0%, 100% { opacity: .8; }
          50% { opacity: 1; }
        }

        @keyframes robot-blink {
          0%, 94%, 100% { transform: scaleY(1); }
          97% { transform: scaleY(.1); }
        }

        @keyframes robot-talk {
          from { transform: scaleY(.6); }
          to { transform: scaleY(1.5); }
        }

        @keyframes robot-think {
          0%, 100% { rotate: 0deg; }
          50% { rotate: 5deg; }
        }

        @media (max-height: 650px) {
          .robot-body { transform: scale(.78); }
        }
      `}</style>

      <div className="robot-floor" />

      <div className="robot-body">
        <div className="robot-head">
          <div className="robot-ear left" />
          <div className="robot-ear right" />
          <div className="robot-face">
            <div className="robot-eyes">
              <span className="robot-eye" />
              <span className="robot-eye" />
            </div>
            <div className="robot-mouth" />
          </div>
        </div>

        <div className="robot-neck" />

        <div className="robot-arm left">
          <div className="robot-hand" />
        </div>

        <div className="robot-arm right">
          <div className="robot-hand" />
        </div>

        <div className="robot-torso">
          <div className="robot-chest" />
        </div>

        <div className="robot-waist" />

        <div className="robot-leg left">
          <div className="robot-foot" />
        </div>

        <div className="robot-leg right">
          <div className="robot-foot" />
        </div>
      </div>
    </div>
  );
}
