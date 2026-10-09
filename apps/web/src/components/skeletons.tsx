/** Skeleton placeholders shown by loading.tsx while a page's data loads. */
export function Bone({ w = "100%", h = 14, r }: { w?: number | string; h?: number; r?: number }) {
  return <div className="skeleton" style={{ width: w, height: h, borderRadius: r }} aria-hidden />;
}

function Header({ actions = true }: { actions?: boolean }) {
  return (
    <div className="row-between">
      <div className="stack-sm" style={{ flex: 1 }}>
        <Bone w={260} h={28} />
        <Bone w={360} />
      </div>
      {actions && <Bone w={150} h={36} r={9} />}
    </div>
  );
}

function CardBones({ lines = 3, height }: { lines?: number; height?: number }) {
  return (
    <div className="card card-pad stack-sm">
      <Bone w="40%" h={18} />
      {height ? <Bone h={height} /> : Array.from({ length: lines }, (_, i) => <Bone key={i} w={`${90 - i * 12}%`} />)}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <main className="container stack-lg" aria-busy="true" aria-label="Loading">
      <Header />
      <div className="grid-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card stat stack-sm"><Bone w="50%" h={10} /><Bone w="70%" h={24} /></div>
        ))}
      </div>
      <div className="grid-2">
        {Array.from({ length: 4 }, (_, i) => <CardBones key={i} />)}
      </div>
    </main>
  );
}

export function ContractSkeleton() {
  return (
    <main className="container stack-lg" aria-busy="true" aria-label="Loading">
      <Header />
      <CardBones height={170} />
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="milestone" style={{ padding: 18 }}>
          <div className="row" style={{ gap: 14 }}>
            <Bone w={30} h={30} r={9} />
            <div className="stack-sm" style={{ flex: 1 }}><Bone w="35%" h={16} /><Bone h={8} r={99} /></div>
          </div>
        </div>
      ))}
    </main>
  );
}

export function InvoiceSkeleton() {
  return (
    <main className="container stack-lg" aria-busy="true" aria-label="Loading">
      <Header />
      <CardBones lines={4} />
      <div className="grid-2"><CardBones /><CardBones /></div>
    </main>
  );
}

export function TableSkeleton() {
  return (
    <main className="container stack-lg" aria-busy="true" aria-label="Loading">
      <Header actions={false} />
      <div className="grid-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card stat stack-sm"><Bone w="50%" h={10} /><Bone w="70%" h={24} /></div>
        ))}
      </div>
      <div className="card card-pad stack-sm">
        {Array.from({ length: 8 }, (_, i) => <Bone key={i} h={20} />)}
      </div>
    </main>
  );
}

export function PortalSkeleton() {
  return (
    <main className="container narrow stack-lg" aria-busy="true" aria-label="Loading">
      <div className="stack-sm"><Bone w={160} h={12} /><Bone w={320} h={28} /><Bone /><Bone w="80%" /></div>
      {Array.from({ length: 3 }, (_, i) => <CardBones key={i} lines={4} />)}
    </main>
  );
}
