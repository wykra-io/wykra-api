import { WykraLogo } from './components/WykraLogo';
import { Footer } from './components/Footer';
import { NetworkBackdrop } from './components/NetworkBackdrop';
import { NetworkIcon } from './components/NetworkIcon';

export function App() {
  return (
    <div className="page">
      <NetworkBackdrop />
      <header className="header">
        <div className="brand">
          <WykraLogo size={64} />
          <div className="brandText">Wykra</div>
        </div>
      </header>

      <main className="main">
        <div className="grid">
          <div>
            <div className="pill">
              <NetworkIcon className="netIcon" />
              Search & analyze TikTok + Instagram influencers
            </div>

            <h1 className="title">
              Find creators. Understand performance. Move faster.
            </h1>

            <p className="subtitle">
              Wykra helps you discover and analyze TikTok and Instagram profiles.
              Search with a prompt or analyze a username to get structured insights.
            </p>

            <div className="actions">
              <a className="primaryBtn" href="https://t.me/wykra_bot">
                Start in Telegram
              </a>
              <a className="secondaryBtn" href="https://app.wykra.io">
                Open Web App
              </a>
            </div>

            <div className="featureRow" aria-label="Key features">
              <div className="feature">
                <span className="featureKicker">Search</span>
                <span className="featureText">
                  Find creators by niche & location
                </span>
              </div>
              <div className="feature">
                <span className="featureKicker">Analyze</span>
                <span className="featureText">
                  Get summaries, signals, and takeaways
                </span>
              </div>
              <div className="feature">
                <span className="featureKicker">Track</span>
                <span className="featureText">
                  Run tasks and fetch results in one place
                </span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="cardHeader">
              <div className="cardHeaderText">
                <div className="cardTitle">Example workflows</div>
                <div className="cardSubtitle">What you can do in seconds</div>
              </div>
            </div>

            <div className="cardList">
              {[
                '“Find 15 creators in Portugal about baking (5k–50k followers)”',
                'Analyze a TikTok profile by username',
                'Analyze an Instagram profile by username',
                'Pull task results + copy a clean list of profiles',
              ].map((t) => (
                <div key={t} className="cardItem">
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
