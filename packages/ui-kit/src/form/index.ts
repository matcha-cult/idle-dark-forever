/**
 * form 分组 barrel。
 *
 * 本组**按需增补**：游戏面板的状态来源是服务端 DTO + 显式意图提交，
 * 因此只收「受控 + 无隐式状态」的表单行组件，不重新包装 antd `Form`。
 */
export { LabeledField, type LabeledFieldProps } from './labeled-field.js';
