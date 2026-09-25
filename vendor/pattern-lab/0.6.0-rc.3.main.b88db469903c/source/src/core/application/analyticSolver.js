// Analytic QP from external src/core.js, accepted delivery 2026-09-16;
// upstream baseline 7ba8898, integration boundary external docs/INTEGRATION.md.
// Kept separate from clipping: all accepted geometry uses the canonical compiler.
import { dot, sub, mul, length as norm } from '../domain/math.js';
const zeros = n => Array(n).fill(0);
const fail = (code, message, details = {}) => Object.assign(new Error(message), { code, details });

// Positive-definite solve. Never silently repair a singular KKT system.
function cholesky(A){const n=A.length,L=Array.from({length:n},()=>zeros(n));
  for(let i=0;i<n;i++)for(let j=0;j<=i;j++){let s=A[i][j];for(let k=0;k<j;k++)s-=L[i][k]*L[j][k];
    if(i===j){if(!(s>1e-16))throw fail('SINGULAR','约束矩阵病态，无法保证精度。');L[i][j]=Math.sqrt(s);}else L[i][j]=s/L[j][j];}
  return b=>{const y=zeros(n),x=zeros(n);for(let i=0;i<n;i++){let s=b[i];for(let k=0;k<i;k++)s-=L[i][k]*y[k];y[i]=s/L[i][i];}
    for(let i=n-1;i>=0;i--){let s=y[i];for(let k=i+1;k<n;k++)s-=L[k][i]*x[k];x[i]=s/L[i][i];}return x;};
}
function orthogonalEquations(eqs,n){const out=[];
  for(const eq of eqs){let v=eq.a.slice(),b=eq.b;const original=norm(v);
    if(original<1e-14){if(Math.abs(b)>2e-9)throw fail('LOCKED',eq.name||'锁定条件与目标冲突。');continue;}
    v=mul(v,1/original);b/=original;
    for(let pass=0;pass<2;pass++)for(const q of out){const k=dot(v,q.a);v=sub(v,mul(q.a,k));b-=k*q.b;}
    const l=norm(v);if(l>1e-10)out.push({a:mul(v,1/l),b:b/l});
    else if(Math.abs(b)>2e-8)throw fail('INCONSISTENT','所选二维位置与当前锁定平面不相容。');
  }return out;
}
/** Convex QP. Analytic equality elimination followed by bounded Hildreth
 * dual coordinate descent for linear inequalities. Not an angle enumeration.
 * A residual failure is NOT a certificate of geometric impossibility.
 */
export function solveQP(H,g,equalities,inequalities){
  const n=g.length,eq=orthogonalEquations(equalities,n),solve=cholesky(H),base=solve(g);
  const inverseRows=eq.map(e=>solve(e.a));
  let solveSchur=null;
  if(eq.length)solveSchur=cholesky(eq.map(a=>inverseRows.map(b=>dot(a.a,b))));
  const correction=eq.length?solveSchur(eq.map(e=>dot(e.a,base)-e.b)):[];
  let x=base.map((v,i)=>v-inverseRows.reduce((s,r,j)=>s+r[i]*correction[j],0));
  function project(a){let v=solve(a);if(eq.length){const w=solveSchur(eq.map(e=>dot(e.a,v)));v=v.map((z,i)=>z-inverseRows.reduce((s,r,j)=>s+r[i]*w[j],0));}return v;}
  const constraints=[];
  for(const e of inequalities){const l=norm(e.a);if(l<1e-13){if(e.b < -2e-8)throw fail('LOCKED',e.name||'目标越过锁定轮廓。');continue;}
    const a=mul(e.a,1/l),b=e.b/l,v=project(a),den=dot(a,v);
    if(den<1e-13){if(dot(a,x)-b>2e-8)throw fail('LOCKED',e.name||'锁定约束无可用自由度。');continue;}
    constraints.push({a,b,v,den,lambda:0});
  }
  let sweeps=0,violation=0,change=0;
  for(;sweeps<800;sweeps++){
    change=0;
    for(const c of constraints){const next=Math.max(0,c.lambda+(dot(c.a,x)-c.b)/c.den),d=next-c.lambda;
      if(Math.abs(d)>1e-16){x=sub(x,mul(c.v,d));change=Math.max(change,Math.abs(d)*norm(c.v));c.lambda=next;}}
    violation=Math.max(0,...constraints.map(c=>dot(c.a,x)-c.b));
    if(violation<1e-9&&change<1e-9)break;
  }
  const eqResidual=Math.max(0,...equalities.map(e=>Math.abs(dot(e.a,x)-e.b)));
  if(violation>2e-8||eqResidual>2e-8||change>1e-6||!x.every(Number.isFinite))throw fail('NO_CONVERGENCE','本次有界求解没有达到精度要求；不是“此位置绝对不可切”的证明。',{violation,eqResidual,sweeps,change});
  return {x,sweeps,violation,eqResidual};
}
