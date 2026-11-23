'use strict';
module.exports={async up(q,S){
 await q.addColumn('stocktakes','disposition_status',{type:S.STRING(24),allowNull:false,defaultValue:'NOT_REQUIRED'});
 await q.addColumn('stocktake_lines','disposition_quantity',{type:S.BIGINT,allowNull:true});
 await q.addColumn('stocktake_lines','disposition_reason',{type:S.TEXT,allowNull:true});
 await q.addColumn('stocktake_lines','disposition_decision',{type:S.STRING(16),allowNull:true});
 await q.addColumn('stocktake_lines','disposition_decided_by',{type:S.BIGINT.UNSIGNED,allowNull:true,references:{model:'users',key:'id'},onDelete:'RESTRICT'});
 await q.addColumn('stocktake_lines','disposition_decided_at',{type:S.DATE,allowNull:true});
 await q.addColumn('stocktake_lines','adjustment_ledger_id',{type:S.BIGINT.UNSIGNED,allowNull:true});
 await q.addIndex('stocktake_lines',['adjustment_ledger_id'],{name:'stocktake_adjustment_ledger_unique',unique:true});
},async down(q){await q.removeIndex('stocktake_lines','stocktake_adjustment_ledger_unique');await q.removeColumn('stocktake_lines','adjustment_ledger_id');await q.removeColumn('stocktake_lines','disposition_decided_at');await q.removeColumn('stocktake_lines','disposition_decided_by');await q.removeColumn('stocktake_lines','disposition_decision');await q.removeColumn('stocktake_lines','disposition_reason');await q.removeColumn('stocktake_lines','disposition_quantity');await q.removeColumn('stocktakes','disposition_status');}};
